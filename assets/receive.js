function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function humanFileSize(bytes, si = false, dp = 1) {
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

async function recover_aes_ctr_key(key_base64, nonce_base64) {
    if (key_base64.length !== 43) {
        throw new Error("key is broken");
    }
    if (nonce_base64.length !== 11) {
        throw new Error("nonce is broken");
    }
    let original_key_base64 =
        key_base64.replace(/[-_]/g, m => ({ "-": "+", _: "/" }[m])) + "=";
    let original_nonce_base64 =
        nonce_base64.replace(/[-_]/g, m => ({ "-": "+", _: "/" }[m])) + "=";
    let key_array = atob(original_key_base64)
        .split("")
        .map(c => c.charCodeAt(0));
    let nonce_array = atob(original_nonce_base64)
        .split("")
        .map(c => c.charCodeAt(0));
    let key_hex = [...key_array]
        .map(x => x.toString(16).padStart(2, "0"))
        .join("");
    let nonce_hex = [...nonce_array]
        .map(x => x.toString(16).padStart(2, "0"))
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

async function decrypt_file_name(key, name_encrypted, nonce, file_id) {
    let file_id_array = new Uint8Array(new Uint32Array([file_id * 2]).buffer);
    let padding_equals = name_encrypted.length % 4;
    if (padding_equals !== 0) {
        padding_equals = 4 - padding_equals;
    }
    let name_encrypted_original_base64 =
        name_encrypted.replace(/[-_]/g, m => ({ "-": "+", _: "/" }[m])) +
        "=".repeat(padding_equals);
    let name_encrypted_array = atob(name_encrypted_original_base64)
        .split("")
        .map(c => c.charCodeAt(0));
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

// async function decrypt_file_part(key, cipher, nonce, file_id, counter) {
//     let counter_array = new Uint8Array(new Uint32Array([counter]).buffer);
//     let file_id_array = new Uint8Array(
//         new Uint32Array([file_id * 2 + 1]).buffer
//     );
//     let CTR = new Uint8Array([
//         ...nonce,
//         ...file_id_array.reverse(),
//         ...counter_array.reverse(),
//     ]);
//     let plain = await crypto.subtle.decrypt(
//         {
//             name: "AES-CTR",
//             counter: CTR,
//             length: 128,
//         },
//         key,
//         cipher
//     );
//     return plain;
// }

// // splits a ReadableStream into chunks of a given size
// // code from https://gist.github.com/thomaskonrad/b8f30e3f18ea2f538bdf422203bdc473
// class StreamSlicer {
//     constructor(chunkSize, processor, progress) {
//         this.chunkSize = chunkSize;
//         this.partialChunk = new Uint8Array(this.chunkSize);
//         this.offset = 0;
//         this.counter = 0;
//         this.processor = processor;
//         this.progress = progress;
//     }
//     async send(buf, writer) {
//         let data = await this.processor(buf, this.counter);
//         await writer.write(data);
//         this.counter += this.chunkSize;
//         this.progress(this.counter);
//         this.partialChunk = new Uint8Array(this.chunkSize);
//         this.offset = 0;
//         this.offset += this.chunkSize;
//     }
//     async transform(chunk, writer) {
//         let i = 0;
//         if (this.offset > 0) {
//             const len = Math.min(
//                 chunk.byteLength,
//                 this.chunkSize - this.offset
//             );
//             this.partialChunk.set(chunk.slice(0, len), this.offset);
//             this.offset += len;
//             i += len;
//             if (this.offset === this.chunkSize) {
//                 await this.send(this.partialChunk, writer);
//             }
//         }
//         while (i < chunk.byteLength) {
//             const remainingBytes = chunk.byteLength - i;
//             if (remainingBytes >= this.chunkSize) {
//                 const record = chunk.slice(i, i + this.chunkSize);
//                 i += this.chunkSize;
//                 await this.send(record, writer);
//             } else {
//                 const end = chunk.slice(i, i + remainingBytes);
//                 i += end.byteLength;
//                 this.partialChunk.set(end);
//                 this.offset = end.byteLength;
//             }
//         }
//     }
//     async flush(writer) {
//         // only for last chunk
//         if (this.offset > 0) {
//             let data = await this.processor(
//                 this.partialChunk.slice(0, this.offset),
//                 this.counter
//             );
//             await writer.write(data);
//         }
//     }
// }

// async function download_file(file_info, writer, progress_callback) {
//     let response = await fetch(file_info.download_url);
//     let cipher_readable_stream = response.body.getReader();
//     let stream_slicer = new StreamSlicer(
//         327680 /* 320KiB */,
//         async function (buf, counter) {
//             let data = await decrypt_file_part(
//                 file_info.key,
//                 buf,
//                 file_info.nonce,
//                 file_info.file_id,
//                 counter / 16
//             );
//             return data;
//             // await writer.write(data);
//         },
//         progress_callback
//     );
//     while (true) {
//         let { done, value } = await cipher_readable_stream.read();
//         if (done) {
//             await stream_slicer.flush(writer);
//             return;
//         }
//         await stream_slicer.transform(value, writer);
//     }
// }

(async function () {
    let file_list = document.getElementById("file-list");
    let notice_area = document.getElementById("notice");
    let cli_command_input = document.getElementById("cli-command");
    if (!("serviceWorker" in navigator)) {
        file_list.innerText =
            "Your browser dose not support service-worker or you are in private window, please switch to Chrome/Edge/Firefox";
        return;
    }
    let reg = await navigator.serviceWorker.register("/s/sw.js", {
        scope: "/s/",
    });
    let current_downloading = 0;
    window.addEventListener("beforeunload", function (event) {
        if (current_downloading > 0) {
            event.preventDefault();
            let message = "Leaving pages will stop downloading. Continue?";
            event.returnValue = message;
            return message;
        }
    });
    let path_list = location.pathname.split("/");
    let read_id = path_list[path_list.length - 1];
    if (read_id === "") {
        document.getElementsByTagName("h1").innerText = "404 NOT FOUND";
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
        document.getElementsByTagName("h1").innerText = "404 NOT FOUND";
        file_list.innerText = "there is nothing here";
        return;
    }
    let list = await response.json();
    file_list.innerText = "";
    for (let i = 0; ; i++) {
        if (navigator.serviceWorker.controller !== null) {
            break;
        }
        await sleep(100);
        if (i >= 50) {
            file_list.innerText = "ERROR: service worker controller is null";
            return;
        }
    }
    for (let file_info of list.value) {
        let info = document.createElement("div");
        let a = document.createElement("a");
        a.href = "/s/download/" + file_info.name;
        let [file_id, file_name_encrypted, ext] = file_info.name.split(".", 2);
        file_id = Number(file_id);
        let filename = await decrypt_file_name(
            key,
            file_name_encrypted,
            nonce,
            file_id
        );
        let download_url = file_info["@microsoft.graph.downloadUrl"];
        await navigator.serviceWorker.controller.postMessage({
            file_path: file_info.name,
            download_url: download_url,
            key: key,
            nonce: nonce,
            filename: filename,
            file_size: file_info.size,
            file_id: file_id,
        });
        a.innerText = filename;
        // a.download = filename; // chrome will request to backend if use download attribute
        a.classList.add("link-like");
        let readable_size = humanFileSize(file_info.size, true, 2);
        let size_node = document.createTextNode(` (${readable_size}) `);
        // a.addEventListener("click", async function (e) {
        //     e.preventDefault();
        //     if (!("showSaveFilePicker" in window)) {
        //         alert(
        //             "your browser dose not support stream saver, please switch to Chrome/Edge or use CLI downloader"
        //         );
        //         return;
        //     }
        //     current_downloading += 1;
        //     let file_handle = await window.showSaveFilePicker({
        //         suggestedName: filename,
        //     });
        //     let file_writer = await file_handle.createWritable();
        //     await download_file(
        //         {
        //             key: key,
        //             nonce: nonce,
        //             file_id: file_id,
        //             file_size: file_info.size,
        //             download_url: download_url,
        //         },
        //         file_writer,
        //         function (downloaded) {
        //             let readable_downloaded = humanFileSize(
        //                 downloaded,
        //                 true,
        //                 2
        //             );
        //             size_node.nodeValue = ` (${readable_downloaded} / ${readable_size}) `;
        //         }
        //     );
        //     file_writer.close();
        //     size_node.nodeValue = ` (downloaded / ${readable_size}) `;
        //     current_downloading -= 1;
        // });
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
        // a.href = "/s/download/" + file_info.name;
        // a.download = filename;
        // await navigator.serviceWorker.controller.postMessage({
        //     file_path: file_info.name,
        //     download_url: download_url,
        //     key: key,
        //     nonce: nonce,
        //     filename: filename,
        //     file_size: file_info.size,
        //     file_id: file_id,
        // });
        // let readable_size = humanFileSize(file_info.size, true, 2);
        // info.append(a);
        // info.append(document.createTextNode(` (${readable_size})`));
        // let cli_downloader = document.createElement("div");
        // let nonce_offset_hex = (Number(file_id) * 2 + 1)
        //     .toString(16)
        //     .padStart(8, "0");
        // cli_downloader.innerText = `wget "${download_url}" -O- | openssl enc -d -aes-256-ctr -K "${key_hex}" -iv "${nonce_hex}${nonce_offset_hex}00000000" -out "${filename}"`;
        info.append(cli_downloader);
        info.classList.add("file-item");
        file_list.append(info);
    }
})();
