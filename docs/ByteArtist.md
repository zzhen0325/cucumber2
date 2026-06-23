# ByteArtist 调用文档

本文记录 Cucumber 当前接入 ByteArtist / 智创网关的完整调用约定。代码以当前仓库实现为准，入口在 [byteartist.ts](../byteartist.ts)，抠图 provider 在 [server/agent/tools/image/byteartist-matting.ts](../server/agent/tools/image/byteartist-matting.ts)。

## 1. 调用模型

ByteArtist 通过智创网关的异步任务接口调用：

1. `POST /media/api/pic/submit_task_v2` 提交任务并获取 `task_id`
2. `POST /media/api/pic/batch_get_result_v2` 按 `task_id` 轮询结果
3. 完成后优先读取 `pic_urls[].main_url` / `backup_url`，没有 URL 时读取 `binary_data`

当前仓库使用两类能力：

| 能力 | req_key / model | 用途 |
| --- | --- | --- |
| 图片生成 | `seed4_0407_lemo` | Lemo / Seed4 文生图 |
| 图片抠图 | `image_matting_lemo` | 透明底、白底或中性底抠图 |

`seed4_0407_lemo` 在本仓库标记为 text-only，不直接接收参考图。若用户带上游图片并要求 Lemo 生图，服务端会先把参考图转为文字描述，再调用 ByteArtist。

## 2. 环境变量

ByteArtist 生图和抠图共用网关凭据：

```bash
BYTEARTIST_BASE_URL=https://lv-api-lf.ulikecam.com
BYTEARTIST_AID=
BYTEARTIST_APP_KEY=
BYTEARTIST_APP_SECRET=
```

也兼容智创网关文档中的别名：

```bash
GATEWAY_BASE_URL=https://lv-api-lf.ulikecam.com
BYTEDANCE_AID=
BYTEDANCE_APP_KEY=
BYTEDANCE_APP_SECRET=
```

生图配置：

```bash
IMAGE_PROVIDER=byteartist
BYTEARTIST_MODEL=seed4_0407_lemo
BYTEARTIST_WIDTH=1024
BYTEARTIST_HEIGHT=1024
BYTEARTIST_MAX_OUTPUT_IMAGES=4
BYTEARTIST_MAX_INPUT_IMAGES=1
BYTEARTIST_MAX_ATTEMPTS=120
BYTEARTIST_POLL_INTERVAL_MS=1000
BYTEARTIST_EXPIRED_DURATION=600
BYTEARTIST_IMAGE_RETURN_TYPE=url
BYTEARTIST_IMAGE_RETURN_FORMAT=png
BYTEARTIST_SEED=-1
```

抠图配置：

```bash
IMAGE_MATTING_PROVIDER=byteartist
BYTEARTIST_MATTING_MODEL=image_matting_lemo
BYTEARTIST_MATTING_BLUE=-1
BYTEARTIST_MATTING_GREEN=-1
BYTEARTIST_MATTING_RED=-1
BYTEARTIST_MATTING_ONLY_MASK=0
BYTEARTIST_MATTING_REFINE_MASK=2
BYTEARTIST_MATTING_IMAGE_RETURN_TYPE=url
BYTEARTIST_MATTING_IMAGE_RETURN_FORMAT=png
```

## 3. 签名规则

每次 submit 和 poll 都要重新生成签名参数。当前实现：

```ts
import { createHash } from "node:crypto";

function generateByteArtistSign(
  nonce: string,
  timestamp: string,
  appSecret: string
) {
  return createHash("sha1")
    .update([nonce, timestamp, appSecret].sort().join(""))
    .digest("hex");
}
```

公共表单字段：

| 字段 | 说明 |
| --- | --- |
| `aid` | 应用 ID |
| `app_key` | App Key |
| `nonce` | 随机正整数 |
| `timestamp` | 秒级 Unix 时间戳 |
| `sign` | SHA1 签名 |
| `req_key` | 算法名 / 模型名 |
| `img_return_type` | 建议 `url` |
| `img_return_format` | 建议 `png` |

请求使用 `application/x-www-form-urlencoded`。不要用 raw JSON。

## 4. 图片参数

智创网关图片参数规则如下：

| 场景 | 表单字段 | 说明 |
| --- | --- | --- |
| 公共 HTTP/HTTPS URL 单图 | `source` | 首选方式，体积小 |
| TOS URL 单图 | `source` | 需要网关支持对应 bucket |
| base64 单图 | `base64file` | 去掉 `data:image/...;base64,` 前缀 |
| 文件二进制单图 | `file` | 需要 multipart/form-data |
| 文件二进制多图 | `files[]` + `input_img_type=multiple_files` | 需要 multipart/form-data |

当前仓库只使用 `source` 和 `base64file`：

```ts
function appendByteArtistImageFormField(
  formData: URLSearchParams,
  image: string
) {
  if (/^(https?:|tos:)\/\//i.test(image)) {
    formData.append("source", image);
    return;
  }

  formData.append(
    "base64file",
    image.startsWith("data:") ? image.split(",")[1] ?? image : image
  );
}
```

不要再使用旧字段 `image`、`image_url` 或 `image_data`。

## 5. 提交任务

接口：

```text
POST {BYTEARTIST_BASE_URL}/media/api/pic/submit_task_v2
Content-Type: application/x-www-form-urlencoded
```

必填业务字段：

| 字段 | 说明 |
| --- | --- |
| `req_json` | 算法参数，JSON stringify 后放入表单 |
| `expired_duration` | 任务过期时间，单位秒，默认 `600` |

生图 `req_json`：

```json
{
  "Prompt": "小龙虾形状的 lemo，米黄色纯色背景",
  "width": 1024,
  "height": 1024,
  "seed": -1
}
```

注意：`seed4_0407_lemo` 使用大写 `Prompt`。其它未显式适配的 ByteArtist 模型默认使用小写 `string`：

```json
{
  "string": "图片提示词",
  "width": 1024,
  "height": 1024,
  "seed": -1
}
```

抠图 `req_json`：

```json
{
  "blue": -1,
  "green": -1,
  "red": -1,
  "only_mask": 0,
  "refine_mask": 2
}
```

背景参数约定：

| 背景 | red | green | blue |
| --- | ---: | ---: | ---: |
| transparent | `-1` | `-1` | `-1` |
| white | `255` | `255` | `255` |
| neutral | `242` | `242` | `239` |

提交成功响应：

```json
{
  "status_code": 0,
  "message": "",
  "data": {
    "task_id": "123456"
  }
}
```

## 6. 轮询结果

接口：

```text
POST {BYTEARTIST_BASE_URL}/media/api/pic/batch_get_result_v2
Content-Type: application/x-www-form-urlencoded
```

必填字段：

| 字段 | 说明 |
| --- | --- |
| `task_ids` | 任务 ID，多个用逗号分隔，最多 10 个 |

可选字段：

| 字段 | 说明 |
| --- | --- |
| `omit_fields` | 不返回的字段，例如 `resp_json,binary_data,req_json` |
| `img_return_type` | `url` 或 `base64` |
| `img_return_format` | `png`、`jpeg`、`webp` 等 |

当前实现每次 poll 都重新带完整签名字段、`req_key`、`img_return_type` 和 `img_return_format`。

结果可能是数组，也可能是按 task id 索引的对象，代码需要兼容两种：

```ts
function readByteArtistResult(data: PollResponse, taskId: string) {
  const results = data.data?.results;
  if (Array.isArray(results)) {
    return results[0] ?? null;
  }
  if (results && typeof results === "object") {
    return results[taskId] ?? Object.values(results)[0] ?? null;
  }
  return null;
}
```

完成状态：

```ts
status === 1 || status === "done" || status === "DONE"
```

失败状态：

```ts
status === 2 || status === "failed" || status === "FAILED"
```

图片提取顺序：

```ts
const urls = (result.pic_urls ?? [])
  .map((item) => item.main_url || item.backup_url)
  .filter(Boolean);

if (urls.length) return urls;

return (result.binary_data ?? []).map(
  (base64) => `data:image/png;base64,${base64.trim()}`
);
```

## 7. Cucumber 当前调用链

### 7.1 生图

运行时入口：

- `generate_image` tool
- provider 选择：`IMAGE_PROVIDER=byteartist`，或用户输入明确提到 `lemo`
- 执行层：[byteartist.ts](../byteartist.ts)

调用链：

1. 服务端从持久化画布重建 upstream context
2. 如果是 `seed4_0407_lemo` 且存在参考图，先用视觉模型改写 prompt
3. `generateByteArtistImage` 提交异步任务
4. poll 成功后拿 provider URL
5. 服务端下载结果并转存到 R2
6. 创建 image artifact，由 runtime materializer 投影到画布

`seed4_0407_lemo` 不直接发送参考图 URL。

### 7.2 抠图

运行时入口：

- Agent tool：`image_matting`
- Toolbar API：`POST /api/projects/:projectId/images/matting`
- provider：`IMAGE_MATTING_PROVIDER=byteartist`
- 执行层：[server/agent/tools/image/byteartist-matting.ts](../server/agent/tools/image/byteartist-matting.ts)

调用链：

1. 客户端只提交选中节点 ID，不提交可信 URL
2. 服务端从项目快照找到 image artifact
3. 服务端根据 `r2://...` content ref 签发短期 R2 read URL
4. ByteArtist 抠图请求使用 `source=<signed http url>`
5. provider 返回结果 URL 或 base64
6. 服务端下载结果 bytes 并转存到 R2
7. 创建新的 image artifact / canvas node，并连到原图节点

只有当调用方没有可拉取 URL、但已经有服务端 bytes 时，才走 `base64file`。

## 8. TypeScript 最小示例

```ts
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

type ByteArtistConfig = {
  aid: string;
  appKey: string;
  appSecret: string;
  baseUrl: string;
  reqKey: string;
};

function sign(nonce: string, timestamp: string, secret: string) {
  return createHash("sha1")
    .update([nonce, timestamp, secret].sort().join(""))
    .digest("hex");
}

function signedForm(config: ByteArtistConfig) {
  const nonce = Math.floor(Math.random() * 2_147_483_647).toString();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const form = new URLSearchParams();
  form.append("aid", config.aid);
  form.append("app_key", config.appKey);
  form.append("nonce", nonce);
  form.append("timestamp", timestamp);
  form.append("sign", sign(nonce, timestamp, config.appSecret));
  form.append("req_key", config.reqKey);
  form.append("img_return_type", "url");
  form.append("img_return_format", "png");
  return form;
}

async function postForm<T>(url: string, body: URLSearchParams): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await response.json()) as T & {
    message?: string;
    status_code?: number;
  };
  if (!response.ok || data.status_code !== 0) {
    throw new Error(`ByteArtist failed: ${data.message ?? response.statusText}`);
  }
  return data;
}

async function submitTask(
  config: ByteArtistConfig,
  reqJson: Record<string, unknown>,
  imageUrl?: string
) {
  const form = signedForm(config);
  form.append("req_json", JSON.stringify(reqJson));
  form.append("expired_duration", "600");
  if (imageUrl) {
    form.append("source", imageUrl);
  }

  const data = await postForm<{ data?: { task_id?: string } }>(
    `${config.baseUrl}/media/api/pic/submit_task_v2`,
    form
  );
  if (!data.data?.task_id) {
    throw new Error("ByteArtist did not return task_id.");
  }
  return data.data.task_id;
}

async function pollTask(config: ByteArtistConfig, taskId: string) {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const form = signedForm(config);
    form.append("task_ids", taskId);
    const data = await postForm<{
      data?: {
        results?:
          | Array<{
              binary_data?: string[];
              pic_urls?: Array<{ backup_url?: string; main_url?: string }>;
              status?: number | string;
            }>
          | Record<
              string,
              {
                binary_data?: string[];
                pic_urls?: Array<{ backup_url?: string; main_url?: string }>;
                status?: number | string;
              }
            >;
      };
    }>(`${config.baseUrl}/media/api/pic/batch_get_result_v2`, form);

    const results = data.data?.results;
    const result = Array.isArray(results)
      ? results[0]
      : results?.[taskId] ?? Object.values(results ?? {})[0];
    if (!result) {
      await delay(1000);
      continue;
    }

    if (result.status === 1 || result.status === "done" || result.status === "DONE") {
      const urls = (result.pic_urls ?? [])
        .map((item) => item.main_url || item.backup_url)
        .filter((url): url is string => Boolean(url));
      if (urls.length) return urls;
      return (result.binary_data ?? []).map(
        (item) => `data:image/png;base64,${item.trim()}`
      );
    }

    if (
      result.status === 2 ||
      result.status === "failed" ||
      result.status === "FAILED"
    ) {
      throw new Error(`ByteArtist task failed: ${taskId}`);
    }

    await delay(1000);
  }

  throw new Error(`ByteArtist task timed out: ${taskId}`);
}
```

文生图：

```ts
const config = {
  aid: process.env.BYTEARTIST_AID!,
  appKey: process.env.BYTEARTIST_APP_KEY!,
  appSecret: process.env.BYTEARTIST_APP_SECRET!,
  baseUrl: process.env.BYTEARTIST_BASE_URL ?? "https://lv-api-lf.ulikecam.com",
  reqKey: "seed4_0407_lemo",
};

const taskId = await submitTask(config, {
  Prompt: "小龙虾形状的 lemo，米黄色纯色背景",
  width: 1024,
  height: 1024,
  seed: -1,
});
const imageUrls = await pollTask(config, taskId);
```

URL 抠图：

```ts
const config = {
  aid: process.env.BYTEARTIST_AID!,
  appKey: process.env.BYTEARTIST_APP_KEY!,
  appSecret: process.env.BYTEARTIST_APP_SECRET!,
  baseUrl: process.env.BYTEARTIST_BASE_URL ?? "https://lv-api-lf.ulikecam.com",
  reqKey: "image_matting_lemo",
};

const taskId = await submitTask(
  config,
  {
    blue: -1,
    green: -1,
    red: -1,
    only_mask: 0,
    refine_mask: 2,
  },
  "https://example.com/source.png"
);
const mattedUrls = await pollTask(config, taskId);
```

## 9. cURL 示例

下面示例只展示字段形状。`nonce`、`timestamp`、`sign` 需要每次请求动态生成。

```bash
curl -X POST "$BYTEARTIST_BASE_URL/media/api/pic/submit_task_v2" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "aid=$BYTEARTIST_AID" \
  --data-urlencode "app_key=$BYTEARTIST_APP_KEY" \
  --data-urlencode "nonce=$NONCE" \
  --data-urlencode "timestamp=$TIMESTAMP" \
  --data-urlencode "sign=$SIGN" \
  --data-urlencode "req_key=image_matting_lemo" \
  --data-urlencode "img_return_type=url" \
  --data-urlencode "img_return_format=png" \
  --data-urlencode 'req_json={"blue":-1,"green":-1,"red":-1,"only_mask":0,"refine_mask":2}' \
  --data-urlencode "expired_duration=600" \
  --data-urlencode "source=https://example.com/source.png"
```

```bash
curl -X POST "$BYTEARTIST_BASE_URL/media/api/pic/batch_get_result_v2" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "aid=$BYTEARTIST_AID" \
  --data-urlencode "app_key=$BYTEARTIST_APP_KEY" \
  --data-urlencode "nonce=$NONCE" \
  --data-urlencode "timestamp=$TIMESTAMP" \
  --data-urlencode "sign=$SIGN" \
  --data-urlencode "req_key=image_matting_lemo" \
  --data-urlencode "img_return_type=url" \
  --data-urlencode "img_return_format=png" \
  --data-urlencode "task_ids=$TASK_ID"
```

## 10. 排障清单

| 现象 | 常见原因 | 检查 |
| --- | --- | --- |
| 上传图片不生效 | 用了旧字段 `image` / `image_url` / `image_data` | URL 必须发 `source`，base64 必须发 `base64file` |
| 返回没有图片 | `img_return_type` 未设为 `url`，或模型返回了 `binary_data` | 同时兼容 `pic_urls` 和 `binary_data` |
| `task_id` 为空 | `status_code` 非 0、签名错误、req_key 错误 | 记录 `message` 和网关错误码 |
| poll 一直处理中 | 模型慢或任务积压 | 提高 `BYTEARTIST_MAX_ATTEMPTS`，保留 1s 左右轮询间隔 |
| 抠图不是透明底 | RGB 参数不是 `-1/-1/-1`，或模型只支持白底 fallback | 检查 `BYTEARTIST_MATTING_*` |
| 抠图接口拿不到原图 | 客户端传了本地 URL 或未保存 artifact | 由服务端从 R2 content ref 签发 read URL |
| Lemo 参考图没有生效 | `seed4_0407_lemo` 当前 text-only | 先把参考图改写成文字 prompt，再调用 ByteArtist |

## 11. 验证命令

相关单测：

```bash
pnpm exec vitest run byteartist.test.ts server/agent/tools/image/byteartist-matting.test.ts server/agent/tools/image/generate-image.test.ts
```

类型检查：

```bash
pnpm exec tsc -b --pretty false
```

本地健康检查：

```bash
curl http://127.0.0.1:8787/api/health
```

期望看到：

```json
{
  "byteArtistConfigured": true,
  "imageMattingConfigured": true,
  "imageMattingProvider": "byteartist",
  "imageMattingModel": "image_matting_lemo"
}
```
