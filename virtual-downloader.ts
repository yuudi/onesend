/// <reference lib="webworker" />
/// <reference no-default-lib="true"/>

export type {}; // make typescript shut up, this line should be deleted after transpiled
declare let self: ServiceWorkerGlobalScope;

const CACHE_KEY = "v1.0.1";

let FilesData = {};

async function decrypt_file_part(
    key: CryptoKey,
    cipher: BufferSource,
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

class Chunker {
    done = false;
    private remaining: Uint8Array | undefined;
    remainingSize = 0;
    private reader: ReadableStreamDefaultReader<Uint8Array>;

    constructor(stream: ReadableStream<Uint8Array>, private size = 16) {
        this.reader = stream.getReader();
    }

    async read(): Promise<
        { done: true; value: undefined } | { done: false; value: Uint8Array }
    > {
        if (this.done) {
            return { done: true, value: undefined };
        }
        const { done, value } = await this.reader.read();
        if (done || value === undefined) {
            this.done = true;
            if (this.remaining === undefined) {
                return { done: true, value: undefined };
            } else {
                return { done: false, value: this.remaining };
            }
        }
        const inSize = value.byteLength + this.remainingSize;
        const remainingSize = inSize % this.size;
        const outSize = inSize - remainingSize;
        let out: Uint8Array;
        if (this.remaining !== undefined) {
            out = new Uint8Array(outSize);
            out.set(this.remaining);
            out.set(
                value.slice(0, value.byteLength - remainingSize),
                this.remainingSize
            );
        } else {
            out = value.slice(0, value.byteLength - remainingSize);
        }

        this.remainingSize = remainingSize;
        if (remainingSize > 0) {
            this.remaining = value.slice(value.byteLength - remainingSize);
        } else {
            this.remaining = undefined;
        }

        return { done: false, value: out };
    }
}

self.addEventListener("activate", function (event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("message", function (event) {
    if (event.data.request === "add_file") {
        FilesData[event.data.file_info.file_path] = event.data.file_info;
    }
});

self.addEventListener("fetch", function (event) {
    let request = event.request;
    let url = new URL(request.url);
    if (request.method !== "GET") {
        return;
    }
    let path = url.pathname;
    if (path.startsWith("/s/download")) {
        event.respondWith(virtual_downloading_response(request));
        return;
    }
    if (path.startsWith("/s/")) {
        request = new Request("/s/*");
    }
    event.respondWith(cached_response(request));
});

function rangeOf(request: Request) {
    let range = request.headers.get("Range");
    if (range === null) {
        return null;
    }
    let range_match = range.match(/^bytes=(\d+)-(\d+)$/);
    if (range_match === null) {
        return null;
    }
    let start = parseInt(range_match[1]);
    let end = parseInt(range_match[2]);
    return [start, end];
}

async function virtual_downloading_response(request: Request) {
    const path = new URL(request.url).pathname;
    let path_list = path.split("/");
    let file_path = path_list[path_list.length - 1];
    let file_info = FilesData[file_path];
    if (file_info === undefined) {
        return new Response("404 NOT FOUND", {
            status: 404,
            statusText: "Not Found",
        });
    }
    let headers = new Headers();
    // let range = rangeOf(request);
    // let start: number;
    // if (range !== null) {
    //     start = range[0];
    // } else {
    //     start = 0;
    // }
    // if (range !== null) {
    //     headers.set("Range", `bytes=${range[0]}-${range[1]}`);
    // }
    //// TODO: handle cases when range does not start from multiple of 16
    let { abort, signal } = new AbortController();
    let response = await fetch(file_info.download_url, { headers, signal });
    let body = response.body;
    if (body === null) {
        return response;
    }
    let reader = new Chunker(body, 16); // chunk stream to size of multiple of 16 bytes
    let decrypted_readable_stream = new ReadableStream({
        async start(controller) {
            let offset = 0;
            while (true) {
                let readResult = await reader.read();
                if (readResult.done) {
                    break;
                }
                let plain = await decrypt_file_part(
                    file_info.key,
                    readResult.value,
                    file_info.nonce,
                    file_info.file_id,
                    offset / 16
                );
                offset += readResult.value.byteLength;
                controller.enqueue(new Uint8Array(plain));
            }
            controller.close();
        },
        cancel() {
            abort();
        },
    });
    // let decrypted_readable_stream = body.pipeThrough(
    //     new TransformStream({
    //         async transform(chunk, controller) {
    //             let plain = await decrypt_file_part(
    //                 file_info.key,
    //                 chunk,
    //                 file_info.nonce,
    //                 file_info.file_id,
    //                 start / 16
    //             );
    //             start += chunk.byteLength;
    //             controller.enqueue(new Uint8Array(plain));
    //         },
    //     })
    // );
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

async function cached_response(request: Request) {
    if (request.method !== "GET") {
        return fetch(request);
    }
    let resp = await caches.match(request);
    if (resp !== undefined) {
        return resp;
    }
    let response = await fetch(request);
    let cache = await caches.open(CACHE_KEY);
    cache.put(request, response.clone());
    return response;
}
