export function humanReadableBytes(bytes: number, si = false, dp = 1) {
  const thresh = si ? 1000 : 1024;
  if (Math.abs(bytes) < thresh) {
    return `${bytes} B`;
  }
  const units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10 ** dp;
  let figure = bytes;
  do {
    figure /= thresh;
    u += 1;
  } while (
    Math.round(Math.abs(figure) * r) / r >= thresh &&
    u < units.length - 1
  );
  return `${figure.toFixed(dp)} ${units[u]}`;
}

export function toUrlSafeBase64(content: string | Uint8Array | Buffer): string {
  let bytes: Uint8Array;
  if (typeof content === 'string') {
    bytes = new TextEncoder().encode(content);
  } else if (content instanceof Uint8Array) {
    bytes = content;
  } else {
    bytes = new Uint8Array(content);
  }
  return btoa(String.fromCharCode.apply(null, Array.from(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function fromUrlSafeBase64(base64Input: string): string {
  const content = base64Input.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - (content.length % 4)) % 4);
  const base64 = content + padding;
  const binaryString = atob(base64);
  return binaryString;
}

export function fromBinaryString(binaryString: string): Uint8Array {
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function newAesGcmKeys() {
  const keyBytes = new Uint8Array(16); // 128 bits
  const nonceBytes = new Uint8Array(16); // 128 bits
  crypto.getRandomValues(keyBytes);
  crypto.getRandomValues(nonceBytes);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    {
      name: 'AES-GCM',
    },
    false,
    ['encrypt', 'decrypt'],
  );
  return {
    cryptoKey,
    nonce: nonceBytes,
    keyBytes,
    nonceBytes,
  };
}

export async function encryptString(
  cryptoKey: CryptoKey,
  nonce: Uint8Array,
  str: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
    },
    cryptoKey,
    data,
  );
  const encryptedBytes = new Uint8Array(encrypted);
  return toUrlSafeBase64(encryptedBytes);
}

export async function decryptString(
  cryptoKey: CryptoKey,
  nonce: Uint8Array,
  encryptedBase64: string,
): Promise<string> {
  const encryptedBytesStr = fromUrlSafeBase64(encryptedBase64);
  const encryptedBytes = fromBinaryString(encryptedBytesStr);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
    },
    cryptoKey,
    encryptedBytes,
  );
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
