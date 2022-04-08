function get_share_history() {
    let history_json = localStorage.sender_history;
    if (history_json === undefined) {
        return [];
    }
    return JSON.parse(history_json);
}
(function () {
    let share_display = document.getElementById("share-history");
    let history = get_share_history();
    if (history.length === 0) {
        share_display.innerText = "no history found";
        return;
    }
    for (let share of history) {
        let info = document.createElement("div");
        let read = document.createElement("a");
        // let write = document.createElement("a");
        info.innerText = share.name;
        read.innerText = "view";
        read.href = "/s/" + share.read_id + "#" + share.keys;
        read.target = "_blank";
        // write.innerText = "modify";
        // write.href = "#";
        // write.addEventListener("click", function () {
        //     return;
        // });
        info.append(document.createTextNode("  "));
        info.append(read);
        // info.append(document.createTextNode("  "));
        // info.append(write);
        info.classList.add("share-item");
        share_display.append(info);
    }
})();
