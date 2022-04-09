// splits a ReadableStream into chunks of a given size
// code from https://gist.github.com/thomaskonrad/b8f30e3f18ea2f538bdf422203bdc473
class StreamSlicer {
    constructor(chunkSize, processor) {
        this.chunkSize = chunkSize;
        this.partialChunk = new Uint8Array(this.chunkSize);
        this.offset = 0;
        this.counter = 0;
        this.processor = processor;
    }
    async send(buf, controller) {
        let data = await this.processor(buf, this.counter);
        controller.enqueue(data);
        this.counter += this.chunkSize;
        this.partialChunk = new Uint8Array(this.chunkSize);
        this.offset = 0;
        this.offset += this.chunkSize;
    }
    async transform(chunk, controller) {
        let i = 0;
        if (this.offset > 0) {
            const len = Math.min(
                chunk.byteLength,
                this.chunkSize - this.offset
            );
            this.partialChunk.set(chunk.slice(0, len), this.offset);
            this.offset += len;
            i += len;
            if (this.offset === this.chunkSize) {
                await this.send(this.partialChunk, controller);
            }
        }
        while (i < chunk.byteLength) {
            const remainingBytes = chunk.byteLength - i;
            if (remainingBytes >= this.chunkSize) {
                const record = chunk.slice(i, i + this.chunkSize);
                i += this.chunkSize;
                await this.send(record, controller);
            } else {
                const end = chunk.slice(i, i + remainingBytes);
                i += end.byteLength;
                this.partialChunk.set(end);
                this.offset = end.byteLength;
            }
        }
    }
    async flush(controller) {
        // only for last chunk
        if (this.offset > 0) {
            let data = await this.processor(
                this.partialChunk.slice(0, this.offset),
                this.counter
            );
            controller.enqueue(data);
        }
    }
}

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
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", function (event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("message", function (event) {
    FilesData[event.data.file_path] = event.data;
});

function decrypt_file_stream(file_info) {
    let stream_slicer = new StreamSlicer(327680 /* 320KiB */, async function (
        buf,
        counter
    ) {
        let data = await decrypt_file_part(
            file_info.key,
            buf,
            file_info.nonce,
            file_info.file_id,
            counter / 16
        );
        return new Uint8Array(data);
    });
    let decrypted_readable_stream = new ReadableStream({
        async start(controller) {
            let response = await fetch(file_info.download_url);
            this.cipher_readable_stream = response.body.getReader();
            while (true) {
                let { done, value } = await this.cipher_readable_stream.read();
                if (done) {
                    await stream_slicer.flush(controller);
                    controller.close();
                    return;
                }
                await stream_slicer.transform(value, controller);
            }
            // controller.enqueue(
            //     new Uint8Array([49, 50, 49, 50, 49, 50, 49, 50, 49, 50])
            // );
            // controller.close();
            // return;
        },
        // async pull(controller) {},
    });
    // TransformStream();
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

self.addEventListener("fetch", function (event) {
    let url = new URL(event.request.url);
    let path = url.pathname;
    if (!path.startsWith("/s/download")) {
        return;
    }
    let path_list = path.split("/");
    let file_path = path_list[path_list.length - 1];
    let file_info = FilesData[file_path];
    if (file_info === undefined) {
        event.respondWith(
            new Response("404 NOT FOUND", {
                status: 404,
                statusText: "Not Found",
            })
        );
        return;
    }
    event.respondWith(decrypt_file_stream(file_info));
});
