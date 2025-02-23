const encoder = new TextEncoder();
let expiredAt = null;
let endpoint = null;
let clientId = "76a75279-2ffa-4c3d-8db8-7b47252aa41c";

const API_KEY = globalThis.API_KEY;

addEventListener("fetch", event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    if (request.method === "OPTIONS") {
        return handleOptions(request);
    }

    // 修改 API Key 验证逻辑
    if (API_KEY) {  // 只在设置了 API_KEY 时才检查认证
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.replace("Bearer ", "") !== API_KEY) {
            return new Response(JSON.stringify({
                error: {
                    message: "Invalid API key",
                    type: "invalid_request_error",
                    code: "invalid_api_key"
                }
            }), {
                status: 401,
                headers: {
                    "Content-Type": "application/json",
                    ...makeCORSHeaders()
                }
            });
        }
    }

    const requestUrl = new URL(request.url);
    const path = requestUrl.pathname;

    switch (path) {
        case "/v1/audio/speech":
            if (request.method !== "POST") {
                return new Response(JSON.stringify({
                    error: {
                        message: "Method not allowed",
                        type: "invalid_request_error",
                        code: "method_not_allowed"
                    }
                }), {
                    status: 405,
                    headers: {
                        "Content-Type": "application/json",
                        ...makeCORSHeaders()
                    }
                });
            }
            return handleTTSPost(request);
        case "/v1/models":
            if (request.method !== "GET") {
                return new Response(JSON.stringify({
                    error: {
                        message: "Method not allowed",
                        type: "invalid_request_error",
                        code: "method_not_allowed"
                    }
                }), {
                    status: 405,
                    headers: {
                        "Content-Type": "application/json",
                        ...makeCORSHeaders()
                    }
                });
            }
            return handleVoicesList(requestUrl);
        default:
            return new Response(JSON.stringify({
                error: {
                    message: "Not found",
                    type: "invalid_request_error",
                    code: "resource_not_found"
                }
            }), {
                status: 404,
                headers: {
                    "Content-Type": "application/json",
                    ...makeCORSHeaders()
                }
            });
    }
}

async function handleOptions(request) {
    return new Response(null, {
        status: 204,
        headers: {
            ...makeCORSHeaders(),
            "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
    });
}

async function handleTTSPost(request) {
    try {
        const body = await request.json();
        const {
            model = "zh-CN-XiaoxiaoMultilingualNeural",
            input,
            voice_settings = {
                speed: 0,
                pitch: 0,
                output_format: "audio-24khz-48kbitrate-mono-mp3"
            }
        } = body;

        if (!input) {
            return new Response(JSON.stringify({
                error: {
                    message: "Input text is required",
                    type: "invalid_request_error",
                    code: "invalid_input"
                }
            }), {
                status: 400,
                headers: {
                    "Content-Type": "application/json",
                    ...makeCORSHeaders()
                }
            });
        }

        const response = await getVoice(
            input,
            model,
            voice_settings.speed,
            voice_settings.pitch,
            voice_settings.output_format,
            false
        );

        return addCORSHeaders(response);
    } catch (error) {
        return new Response(JSON.stringify({
            error: {
                message: "Internal server error",
                type: "server_error",
                code: "internal_error"
            }
        }), {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                ...makeCORSHeaders()
            }
        });
    }
}

async function handleVoicesList(requestUrl) {
    try {
        const voices = await voiceList();
        const formattedVoices = voices.map(voice => ({
            id: voice.ShortName,
            object: "model",
            created: Math.floor(1600000000 + Math.random() * 100000000),
            owned_by: "Zwei",
            permission: [
                {
                    id: `modelperm-${uuid().substring(0, 24)}`,
                    object: "model_permission",
                    created: Math.floor(Date.now() / 1000),
                    allow_create_engine: false,
                    allow_sampling: false,
                    allow_logprobs: false,
                    allow_search_indices: false,
                    allow_view: true,
                    allow_fine_tuning: false,
                    organization: "*",
                    group: null,
                    is_blocking: false
                }
            ],
            root: voice.ShortName,
            parent: null
        }));

        return new Response(JSON.stringify({
            data: formattedVoices,
            object: "list"
        }), {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                ...makeCORSHeaders()
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            error: {
                message: "Failed to fetch voice models",
                type: "server_error",
                code: "internal_error"
            }
        }), {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                ...makeCORSHeaders()
            }
        });
    }
}

async function getVoice(text, voiceName, rate, pitch, outputFormat, download) {
    await refreshEndpoint();
    const url = `https://${endpoint.r}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const headers = {
        "Authorization": endpoint.t,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": outputFormat,
        "User-Agent": "okhttp/4.5.0"
    };

    const ssml = generateSsml(text, voiceName, rate, pitch);
    const response = await fetch(url, {
        method: "POST",
        headers,
        body: ssml
    });

    if (response.ok) {
        const newResponse = new Response(response.body, response);
        if (download) {
            newResponse.headers.set("Content-Disposition", `attachment; filename="${uuid()}.mp3"`);
        }
        return newResponse;
    } else {
        throw new Error(`TTS 请求失败，状态码 ${response.status}`);
    }
}

function generateSsml(text, voiceName, rate, pitch) {
    return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN"> 
                <voice name="${voiceName}"> 
                    <mstts:express-as style="general" styledegree="1.0" role="default"> 
                        <prosody rate="${rate}%" pitch="${pitch}%" volume="50">${text}</prosody> 
                    </mstts:express-as> 
                </voice> 
            </speak>`;
}

function formatVoiceItem(item) {
    return `
- !!org.nobody.multitts.tts.speaker.Speaker
  avatar: ''
  code: ${item.ShortName}
  desc: ''
  extendUI: ''
  gender: ${item.Gender === "Female" ? "0" : "1"}
  name: ${item.LocalName}
  note: 'wpm: ${item.WordsPerMinute || ""}'
  param: ''
  sampleRate: ${item.SampleRateHertz || "24000"}
  speed: 1.5
  type: 1
  volume: 1`;
}

async function voiceList() {
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "X-Ms-Useragent": "SpeechStudio/2021.05.001",
        "Content-Type": "application/json",
        "Origin": "https://azure.microsoft.com",
        "Referer": "https://azure.microsoft.com"
    };
    const response = await fetch("https://eastus.api.speech.microsoft.com/cognitiveservices/voices/list", {
        headers: headers,
        cf: {
            cacheTtl: 600,
            cacheEverything: true,
            cacheKey: "mstrans-voice-list"
        }
    });
    if (!response.ok) {
        throw new Error(`获取语音列表失败，状态码 ${response.status}`);
    }
    return response.json();
}

function addCORSHeaders(response) {
    const newHeaders = new Headers(response.headers);
    Object.entries(makeCORSHeaders()).forEach(([key, value]) => {
        newHeaders.set(key, value);
    });
    return new Response(response.body, { ...response, headers: newHeaders });
}

function makeCORSHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
    };
}

async function refreshEndpoint() {
    if (!expiredAt || Date.now() / 1000 > expiredAt - 60) {
        endpoint = await getEndpoint();
        const decodedJwt = JSON.parse(atob(endpoint.t.split(".")[1]));
        expiredAt = decodedJwt.exp;
        clientId = uuid();
        console.log(`获取 Endpoint, 过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
    } else {
        console.log(`过期时间剩余: ${((expiredAt - Date.now() / 1000) / 60).toFixed(2)} 分钟`);
    }
}

async function getEndpoint() {
    const endpointUrl = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
    const headers = {
        "Accept-Language": "zh-Hans",
        "X-ClientVersion": "4.0.530a 5fe1dc6c",
        "X-UserId": "0f04d16a175c411e",
        "X-HomeGeographicRegion": "zh-Hans-CN",
        "X-ClientTraceId": clientId,
        "X-MT-Signature": await generateSignature(endpointUrl),
        "User-Agent": "okhttp/4.5.0",
        "Content-Type": "application/json; charset=utf-8",
        "Accept-Encoding": "gzip"
    };
    const response = await fetch(endpointUrl, {
        method: "POST",
        headers: headers
    });
    if (!response.ok) {
        throw new Error(`获取 Endpoint 失败，状态码 ${response.status}`);
    }
    return response.json();
}

async function generateSignature(urlStr) {
    const url = urlStr.split("://")[1];
    const encodedUrl = encodeURIComponent(url);
    const uuidStr = uuid();
    const formattedDate = formatDate();
    const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
    const decodedKey = await base64ToBytes("oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==");
    const signature = await hmacSha256(decodedKey, bytesToSign);
    const signatureBase64 = await bytesToBase64(signature);
    return `MSTranslatorAndroidApp::${signatureBase64}::${formattedDate}::${uuidStr}`;
}

function formatDate() {
    const date = new Date();
    const utcString = date.toUTCString().replace(/GMT/, "").trim() + " GMT";
    return utcString.toLowerCase();
}

async function hmacSha256(key, data) {
    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        key,
        { name: "HMAC", hash: { name: "SHA-256" } },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
    return new Uint8Array(signature);
}

async function base64ToBytes(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
}

function uuid() {
    return crypto.randomUUID().replace(/-/g, "");
}