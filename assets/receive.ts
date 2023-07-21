///<reference lib="es2021" />

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function recover_aes_ctr_key(key_base64: string, nonce_base64: string) {
    if (key_base64.length !== 43) {
        throw new Error("key is broken");
    }
    if (nonce_base64.length !== 11) {
        throw new Error("nonce is broken");
    }
    let original_key_base64 =
        key_base64.replaceAll("-", "+").replaceAll("_", "/") + "=";
    let original_nonce_base64 =
        nonce_base64.replaceAll("-", "+").replaceAll("_", "/") + "=";
    let key_array = atob(original_key_base64)
        .split("")
        .map((c) => c.charCodeAt(0));
    let nonce_array = atob(original_nonce_base64)
        .split("")
        .map((c) => c.charCodeAt(0));
    let key_hex = [...key_array]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
    let nonce_hex = [...nonce_array]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
    let key = await crypto.subtle.importKey(
        "raw",
        new Uint8Array(key_array),
        {
            name: "AES-CTR",
        },
        false,
        ["encrypt", "decrypt"]
    );
    return {
        key: key,
        key_hex: key_hex,
        nonce: new Uint8Array(nonce_array),
        nonce_hex: nonce_hex,
    };
}

async function decrypt_file_name(
    key: CryptoKey,
    name_encrypted: string,
    nonce: Uint8Array,
    file_id: number
) {
    let file_id_array = new Uint8Array(new Uint32Array([file_id * 2]).buffer);
    let padding_equals = name_encrypted.length % 4;
    if (padding_equals !== 0) {
        padding_equals = 4 - padding_equals;
    }
    let name_encrypted_original_base64 =
        name_encrypted.replaceAll("-", "+").replaceAll("_", "/") +
        "=".repeat(padding_equals);
    let name_encrypted_array = atob(name_encrypted_original_base64)
        .split("")
        .map((c) => c.charCodeAt(0));
    let CTR = new Uint8Array([
        ...nonce,
        ...file_id_array.reverse(),
        0,
        0,
        0,
        0,
    ]);
    let plain_filename_array = await crypto.subtle.decrypt(
        { name: "AES-CTR", counter: CTR, length: 128 },
        key,
        new Uint8Array(name_encrypted_array)
    );
    let dec = new TextDecoder();
    return dec.decode(plain_filename_array);
}

function throwError(message: string): never {
    throw new Error(message);
}

(async function () {
    let file_list =
        document.getElementById("file-list") ??
        throwError("file-list not found");
    let notice_area =
        document.getElementById("notice") ?? throwError("notice not found");
    let cli_command_input =
        (document.getElementById("cli-command") as HTMLInputElement) ??
        throwError("cli-command not found");
    const serviceWorker = navigator.serviceWorker;
    if (serviceWorker === undefined) {
        file_list.innerText =
            "Your browser dose not support service-worker or you are in private window, please switch to Chrome/Edge/Firefox";
        return;
    }
    let reg = await serviceWorker.register("/sw.js", { scope: "/" });
    let current_downloading = 0;
    // window.addEventListener("beforeunload", function (event) {
    //     if (current_downloading > 0) {
    //         event.preventDefault();
    //         let message = "Leaving pages will stop downloading. Continue?";
    //         event.returnValue = message;
    //         return message;
    //     }
    // });
    serviceWorker.addEventListener("message", function (event) {
        if (event.data.request === "download_finished") {
            current_downloading -= 1;
        }
    });
    let path_list = location.pathname.split("/");
    let read_id = path_list[path_list.length - 1];
    if (read_id === "") {
        (document.querySelector("h1") ?? throwError("h1 not found")).innerText =
            "404 NOT FOUND";
        file_list.innerText = "there is nothing here";
        return;
    }
    let [key_base64, nonce_base64] = location.hash.substring(1).split(".");
    if (key_base64.length !== 43 || nonce_base64.length !== 11) {
        file_list.innerText = "oops, share link is broken";
        return;
    }
    let { key, key_hex, nonce, nonce_hex } = await recover_aes_ctr_key(
        key_base64,
        nonce_base64
    );
    let response = await fetch("/api/v1/share/" + read_id);
    if (response.status >= 400) {
        (document.querySelector("h1") ?? throwError("h1 not found")).innerText =
            "404 NOT FOUND";
        file_list.innerText = "there is nothing here";
        return;
    }
    let list = await response.json();
    file_list.innerText = "";
    for (let i = 0; ; i++) {
        if (serviceWorker.controller !== null) {
            break;
        }
        await sleep(100);
        if (i >= 50) {
            file_list.innerText = "ERROR: service worker controller is null";
            return;
        }
    }
    for (let file_info of list.value) {
        let encrypted_filename = file_info.name;
        if (!encrypted_filename.endsWith(".send")) {
            continue;
        }
        let info = document.createElement("div");
        let a = document.createElement("span");
        a.classList.add("link-like");
        let download_url = file_info["@microsoft.graph.downloadUrl"];
        let [file_id, file_name_encrypted, ext] = file_info.name.split(".", 2);
        file_id = Number(file_id);
        let filename = await decrypt_file_name(
            key,
            file_name_encrypted,
            nonce,
            file_id
        );
        a.addEventListener("click", async function () {
            current_downloading += 1;
            await serviceWorker.controller?.postMessage({
                request: "add_file",
                file_info: {
                    file_path: encrypted_filename,
                    download_url: download_url,
                    key: key,
                    nonce: nonce,
                    filename: filename,
                    file_size: file_info.size,
                    file_id: file_id,
                },
            });
            let file_link = document.createElement("a");
            file_link.href = "/s/download/" + encrypted_filename;
            file_link.click();
        });
        setInterval(function () {
            // keep service work alive
            serviceWorker.controller?.postMessage({ request: "ping" });
        }, 100);
        a.innerText = filename;
        let readable_size = humanFileSize(file_info.size, true, 2);
        let size_node = document.createTextNode(` (${readable_size}) `);
        info.append(a);
        info.append(size_node);
        let nonce_offset_hex = (file_id * 2 + 1).toString(16).padStart(8, "0");
        let cli_downloader = document.createElement("span");
        cli_downloader.innerText = "CLI";
        cli_downloader.classList.add("link-like");
        cli_downloader.addEventListener("click", async function () {
            let cli_command = `wget "${download_url}" -O - | openssl enc -d -aes-256-ctr -K "${key_hex}" -iv "${nonce_hex}${nonce_offset_hex}00000000" -out "${filename}"`;
            await navigator.clipboard.writeText(cli_command);
            cli_command_input.value = cli_command;
            cli_command_input.hidden = false;
            cli_command_input.select();
            notice_area.innerText = "command copied";
            setTimeout(function () {
                notice_area.innerText = "";
            }, 2000);
        });
        info.append(cli_downloader);
        info.classList.add("file-item");
        file_list.append(info);
    }
})();
