///<reference lib="es2021" />

function humanFileSize(bytes: number, si = false, dp = 1) {
    const thresh = si ? 1000 : 1024;
    if (Math.abs(bytes) < thresh) {
        return bytes + " B";
    }
    const units = si
        ? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
        : ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
    let u = -1;
    const r = 10 ** dp;
    do {
        bytes /= thresh;
        ++u;
    } while (
        Math.round(Math.abs(bytes) * r) / r >= thresh &&
        u < units.length - 1
    );
    return bytes.toFixed(dp) + " " + units[u];
}

async function generate_aes_ctr_keys() {
    let key_array = new Uint8Array(32); // 256 bits
    let nonce_array = new Uint8Array(8); // 64 bits
    crypto.getRandomValues(key_array);
    crypto.getRandomValues(nonce_array);
    let key = await crypto.subtle.importKey(
        "raw",
        key_array,
        {
            name: "AES-CTR",
        },
        false,
        ["encrypt", "decrypt"]
    );
    return {
        key: key,
        key_base64: btoa(String.fromCharCode.apply(null, key_array))
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replaceAll("=", ""),
        nonce: nonce_array,
        nonce_base64: btoa(String.fromCharCode.apply(null, nonce_array))
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replaceAll("=", ""),
    };
}

async function encrypt_file_name(
    key: CryptoKey,
    filename: string,
    nonce: Uint8Array,
    file_id: number
) {
    let file_id_array = new Uint8Array(new Uint32Array([file_id * 2]).buffer);
    let CTR = new Uint8Array([
        ...nonce,
        ...file_id_array.reverse(),
        0,
        0,
        0,
        0,
    ]);
    let enc = new TextEncoder();
    let encrypted_filename_array = await crypto.subtle.encrypt(
        {
            name: "AES-CTR",
            counter: CTR,
            length: 128,
        },
        key,
        enc.encode(filename)
    );
    let encrypted_filename_base64 = btoa(
        String.fromCharCode.apply(
            null,
            new Uint8Array(encrypted_filename_array)
        )
    )
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
    return file_id + "." + encrypted_filename_base64;
}

async function encrypt_file_part(
    key: CryptoKey,
    plain: BufferSource,
    nonce: Uint8Array,
    file_id: number,
    counter: number
) {
    let counter_array = new Uint8Array(new Uint32Array([counter]).buffer);
    let file_id_array = new Uint8Array(
        new Uint32Array([file_id * 2 + 1]).buffer
    );
    let CTR = new Uint8Array([
        ...nonce,
        ...file_id_array.reverse(),
        ...counter_array.reverse(),
    ]);
    let cipher = await crypto.subtle.encrypt(
        {
            name: "AES-CTR",
            counter: CTR,
            length: 128,
        },
        key,
        plain
    );
    return cipher;
}

function share_history_append(
    name: string,
    read_id: string,
    write_id: string,
    keys: string
) {
    let history_json = localStorage.sender_history;
    if (history_json === undefined) {
        history_json = "[]";
    }
    let history = JSON.parse(history_json);
    history.push({
        name: name,
        read_id: read_id,
        write_id: write_id,
        keys: keys,
    });
    localStorage.sender_history = JSON.stringify(history);
}

function getElementByIdOrThrowError(id: string) {
    let element = document.getElementById(id);
    if (element === null) {
        throw new Error(`Element with id ${id} not found`);
    }
    return element;
}

interface Share {
    name: string;
    read_id: string;
    write_id: string;
    keys: string;
}

(function () {
    const serviceWorker = navigator.serviceWorker;
    serviceWorker.register("/sw.js", { scope: "/" });

    const size_unit = 327680;
    const max_size = 192;
    let read_id: string, write_id: string;
    let key: CryptoKey,
        key_base64: string,
        nonce: Uint8Array,
        nonce_base64: string;
    let history_link = getElementByIdOrThrowError("history-link");
    let share_history = getElementByIdOrThrowError("share-history");
    let sharing = getElementByIdOrThrowError("sharing");
    let select_button = getElementByIdOrThrowError("select-button");
    let file_list = getElementByIdOrThrowError("file-list");
    let upload_button = getElementByIdOrThrowError(
        "upload-button"
    ) as HTMLButtonElement;
    let main_display = getElementByIdOrThrowError("main-display");
    let files_selected: {
        file: File;
        dom: HTMLTableRowElement;
        process: HTMLTableCellElement;
        file_id: number;
    }[] = [];
    let file_id_counter = 0;
    history_link.addEventListener("click", function () {
        share_history.textContent = "";
        let history_json = localStorage.sender_history;
        if (!history_json) {
            share_history.innerText = "No sharing history";
            return;
        }
        let history: Share[] = JSON.parse(history_json);
        for (let share of history) {
            let info = document.createElement("div");
            let read = document.createElement("a");
            info.innerText = share.name;
            read.innerText = "view";
            read.href = "/s/" + share.read_id + "#" + share.keys;
            read.target = "_blank";
            info.append(document.createTextNode("  "));
            info.append(read);
            info.classList.add("share-item");
            share_history.append(info);
        }
    });
    select_button.addEventListener("click", function () {
        let selector = document.createElement("input");
        selector.type = "file";
        selector.multiple = true;
        selector.addEventListener("change", function () {
            if (!selector.files) {
                return;
            }
            for (let f of selector.files) {
                let row = document.createElement("tr");
                let name = document.createElement("td");
                name.innerText = f.name;
                row.append(name);
                let size = document.createElement("td");
                size.innerText = "(" + humanFileSize(f.size, true, 2) + ")";
                row.append(size);
                let file_upload_process = document.createElement("td");
                row.append(file_upload_process);
                file_list.append(row);
                files_selected.push({
                    file: f,
                    dom: row,
                    process: file_upload_process,
                    file_id: file_id_counter,
                });
                file_id_counter += 1;
            }
            upload_button.disabled = false;
        });
        selector.click();
    });
    upload_button.addEventListener("click", async function () {
        upload_button.disabled = true;
        upload_button.innerText = "Uploading...";
        select_button.innerText = "Add more files";
        if (write_id === undefined) {
            let response = await fetch("/api/v1/share", {
                method: "POST",
            });
            let payload = await response.json();
            read_id = payload.read_id;
            write_id = payload.write_id;
            ({ key, key_base64, nonce, nonce_base64 } =
                await generate_aes_ctr_keys());
        }
        let files = files_selected;
        files_selected = [];
        let total_file_count = files.length;
        if (total_file_count === 0) {
            window.alert("select file!");
            return;
        }
        for (let i = 0; i < total_file_count; i++) {
            let file_upload = files[i].file;
            let encrypted_filename = await encrypt_file_name(
                key,
                file_upload.name,
                nonce,
                files[i].file_id
            );
            let response = await fetch("/api/v1/attachment", {
                method: "POST",
                body: JSON.stringify({
                    name: encrypted_filename + ".send",
                    write_id: write_id,
                }),
            });
            let payload = await response.json();
            let upload_url = payload.upload_url;
            if (upload_url === undefined) {
                window.alert("upload error");
                return;
            }
            files[i].process.innerText = "0 %";
            let file_size = file_upload.size;
            let slices_count = Math.floor(file_size / size_unit);
            let transfer_count = 4;
            for (let j = 0; j <= slices_count; ) {
                let begin = j * size_unit;
                let end: number;
                if (j + transfer_count > slices_count) {
                    end = file_size - 1;
                } else {
                    end = (j + transfer_count) * size_unit - 1;
                }
                let file_part = await file_upload
                    .slice(begin, end + 1)
                    .arrayBuffer();
                let encrypted_part = await encrypt_file_part(
                    key,
                    file_part,
                    nonce,
                    files[i].file_id,
                    begin / 16
                );
                let start_time = performance.now();
                await (function () {
                    return new Promise(function (resolve, reject) {
                        let upload_part = new XMLHttpRequest();
                        upload_part.open("PUT", upload_url);
                        upload_part.setRequestHeader(
                            "Content-Range",
                            `bytes ${begin}-${end}/${file_size}`
                        );
                        upload_part.upload.addEventListener(
                            "progress",
                            function (e) {
                                let percentage =
                                    (100 * (begin + e.loaded)) / file_size;
                                files[i].process.innerText =
                                    percentage.toFixed(2) + " %";
                            }
                        );
                        upload_part.addEventListener("load", function () {
                            if (this.status >= 200 && this.status < 300) {
                                resolve(upload_part.response);
                            } else {
                                reject(upload_part.response);
                            }
                        });
                        upload_part.addEventListener("error", function (e) {
                            reject(e);
                        });
                        upload_part.send(encrypted_part);
                    });
                })();
                j += transfer_count;
                let transfer_time = performance.now() - start_time;
                transfer_count = Math.ceil(
                    (transfer_count * 10000) / transfer_time
                ); // adjust each part to 10s
                if (transfer_count > max_size) {
                    transfer_count = max_size;
                }
            }
            files[i].process.innerText = "100.00 %";
        }
        main_display.innerText =
            "your share has been created. you can send this link to your friends";
        share_history_append(
            files[0].file.name + (files.length > 1 ? " and other files" : ""),
            read_id,
            write_id,
            key_base64 + "." + nonce_base64
        );
        let share_url =
            location.origin +
            "/s/" +
            read_id +
            "#" +
            key_base64 +
            "." +
            nonce_base64;
        let link = document.createElement("a");
        link.innerText = "Open Link";
        link.href = share_url;
        link.target = "_blank";
        let copy_link = document.createElement("span");
        copy_link.innerText = "Copy Link";
        copy_link.classList.add("link-like");
        copy_link.addEventListener("click", function () {
            navigator.clipboard.writeText(share_url);
            copy_link.innerText = "Link Copied";
        });
        main_display.append(document.createElement("br"));
        main_display.append(link);
        main_display.append(document.createTextNode(" "));
        main_display.append(copy_link);
        upload_button.disabled = false;
        upload_button.innerText = "Upload";
        window.alert("Upload Successfully!");
    });
})();
