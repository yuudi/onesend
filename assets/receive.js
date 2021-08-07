(async function () {
    let file_list = document.getElementById("file-list");
    let path_list = location.pathname.split("/");
    let read_id = path_list[path_list.length - 1];
    if (read_id === "") {
        document.getElementsByTagName("h1").innerText = "404 NOT FOUND";
        file_list.innerText = "there is nothing here";
        return;
    }
    let response = await fetch("/api/v1/share/" + read_id);
    if (response.status >= 400) {
        document.getElementsByTagName("h1").innerText = "404 NOT FOUND";
        file_list.innerText = "there is nothing here";
        return;
    }
    let list = await response.json();
    file_list.innerText = "";
    for (let fileInfo of list.value) {
        let info = document.createElement("div");
        let a = document.createElement("a");
        a.innerText = fileInfo.name;
        a.href = fileInfo["@microsoft.graph.downloadUrl"];
        a.download = fileInfo.name;
        let readable_size = humanFileSize(fileInfo.size, true, 2);
        info.append(a);
        info.append(document.createTextNode(` (${readable_size})`));
        info.classList.add("file-item");
        file_list.append(info);
    }
})();
