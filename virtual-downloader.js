const CACHE_KEY = "v1.0.1";

let FilesData = {};

async function decrypt_file_part(key, cipher, nonce, file_id, counter) {
    let counter_array = new Uint8Array(new Uint32Array([counter]).buffer);
    let file_id_array = new Uint8Array(
        new Uint32Array([file_id * 2 + 1]).buffer
    );
    let CTR = new Uint8Array([
        ...nonce,
        ...file_id_array.reverse(),
        ...counter_array.reverse(),
    ]);
    let plain = await crypto.subtle.decrypt(
        {
            name: "AES-CTR",
            counter: CTR,
            length: 128,
        },
        key,
        cipher
    );
    return plain;
}

self.addEventListener("install", function (event) {
    event.waitUntil(
        (async function () {
            let cache = await caches.open(CACHE_KEY);
            return cache.addAll([
                "/assets/favicon.ico",
                "/",
                "/assets/homepage.js",
                "/assets/homepage.css",
                "/s/*",
                "/assets/receive.js",
                "/assets/receive.css",
            ]);
        })()
    );
});

self.addEventListener("activate", function (event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("message", function (event) {
    if (event.data.request === "add_file") {
        FilesData[event.data.file_info.file_path] = event.data.file_info;
    }
});

async function try_fetch(input, init, tries = 3) {
    try {
        return await fetch(input, init);
    } catch (e) {
        if (tries > 0) {
            return try_fetch(input, init, tries - 1);
        }
        throw e;
    }
}

self.addEventListener("fetch", function (event) {
    let request = event.request;
    let url = new URL(request.url);
    let path = url.pathname;
    if (path.startsWith("/s/download")) {
        event.respondWith(virtual_downloading_response(path));
        return;
    }
    if (path.startsWith("/s/")) {
        request = new Request("/s/*");
    }
    event.respondWith(cached_response(request));
});

async function virtual_downloading_response(path) {
    let path_list = path.split("/");
    let file_path = path_list[path_list.length - 1];
    let file_info = FilesData[file_path];
    if (file_info === undefined) {
        return new Response("404 NOT FOUND", {
            status: 404,
            statusText: "Not Found",
        });
    }
    let decrypted_readable_stream = new ReadableStream({
        async start(controller) {
            const chunk_size = 1310720;
            let chunk_number = Math.ceil(file_info.file_size / chunk_size);
            let fetched = 0;
            let fetch_queue = [];
            async function next_fetch() {
                if (fetched >= chunk_number) {
                    return null;
                }
                let i = fetched;
                fetched += 1;
                let start = i * chunk_size;
                let end;
                if (i === chunk_number - 1) {
                    end = file_info.file_size - 1;
                } else {
                    end = start + chunk_size - 1;
                }
                let response = await try_fetch(file_info.download_url, {
                    headers: { Range: `bytes=${start}-${end}` },
                });
                let data = await response.arrayBuffer();
                let plain = await decrypt_file_part(
                    file_info.key,
                    data,
                    file_info.nonce,
                    file_info.file_id,
                    start / 16
                );
                return new Uint8Array(plain);
            }
            fetch_queue.push(next_fetch());
            setTimeout(function () {
                // 4 concurrent download
                fetch_queue.push(next_fetch());
                fetch_queue.push(next_fetch());
                fetch_queue.push(next_fetch());
            }, 1000);
            for (let j = 0; j < chunk_number; j++) {
                let chunk = await fetch_queue.shift();
                controller.enqueue(chunk);
                fetch_queue.push(next_fetch());
            }
            controller.close();
        },
    });
    return new Response(decrypted_readable_stream, {
        headers: {
            "Content-Length": file_info.file_size,
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
                file_info.filename
            )}`,
        },
    });
}

async function cached_response(request) {
    let resp = await caches.match(request.pathname);
    if (resp !== undefined) {
        return resp;
    }
    let response = await fetch(request);
    let cache = await caches.open(CACHE_KEY);
    cache.put(request, response.clone());
    return response;
}
