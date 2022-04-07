function share_history_append(name, read_id, write_id) {
    let history_json = localStorage.sender_history;
    if (history_json === undefined) {
        history_json = "[]";
    }
    let history = JSON.parse(history_json);
    history.push({
        name: name,
        read_id: read_id,
        write_id: write_id,
    });
    localStorage.sender_history = JSON.stringify(history);
}

(function () {
    const size_unit = 327680;
    const max_size = 192;
    let read_id, write_id;
    let sharing = document.getElementById("sharing");
    let select_button = document.getElementById("select-button");
    let file_list = document.getElementById("file-list");
    let upload_button = document.getElementById("upload-button");
    let main_display = document.getElementById("main-display");
    let files_selected = [];
    select_button.addEventListener("click", function () {
        let selector = document.createElement("input");
        selector.type = "file";
        selector.multiple = true;
        selector.addEventListener("change", function () {
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
                });
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
            let response = await fetch("/api/v1/attachment", {
                method: "POST",
                body: JSON.stringify({
                    name: file_upload.name,
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
            let file_content = await file_upload.arrayBuffer();
            for (let j = 0; j <= slices_count; ) {
                let begin = j * size_unit;
                let end;
                if (j + transfer_count > slices_count) {
                    end = file_size - 1;
                } else {
                    end = (j + transfer_count) * size_unit - 1;
                }
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
                                files[i].process.innerText = "100.00 %";
                                resolve(upload_part.response);
                            } else {
                                reject(upload_part.response);
                            }
                        });
                        upload_part.addEventListener("error", function (e) {
                            reject(e);
                        });
                        upload_part.send(file_content.slice(begin, end + 1));
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
        }
        main_display.innerText =
            "your share has been created. you can send this link to your friends";
        share_history_append(
            files[0].file.name + (files.length > 1 ? " and other files" : ""),
            read_id,
            write_id
        );
        let share_url = location.origin + "/s/" + read_id;
        let link = document.createElement("a");
        link.innerText = share_url;
        link.href = share_url;
        link.target = "_blank";
        main_display.append(document.createElement("br"));
        main_display.append(link);
        upload_button.disabled = false;
        upload_button.innerText = "Upload";
        window.alert("Upload Successfully!");
    });
})();
