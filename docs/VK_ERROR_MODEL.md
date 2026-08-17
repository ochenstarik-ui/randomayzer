# VK API Error Model & Mapping

Randomayzer translates raw VK API response errors into typed error classes under `src/integrations/vk/vk-errors.ts`.

---

## Error Classification & Retry Matrix

| Error Class | Category | VK Error Code(s) | Retryable? | Description |
|---|---|---|---|---|
| `VkAuthError` | `AUTH` | 4, 5, 28 | **No** | Invalid, expired, or unauthorized access token. |
| `VkPermissionError` | `PERMISSION` | 7, 260 | **No** | Permission to perform action denied. |
| `VkPrivateResourceError` | `PRIVATE_RESOURCE` | 15, 30, 203 | **No** | Target profile, group, or wall post is private. |
| `VkNotFoundError` | `NOT_FOUND` | 104, 210, 214 | **No** | Post or community does not exist. |
| `VkValidationError` | `VALIDATION` | 100, 113, 150 | **No** | Invalid query parameters or bad request. |
| `VkRateLimitError` | `RATE_LIMIT` | 6, 9, 29 | **Yes** | Too many requests per second or flood control. |
| `VkTemporaryError` | `TEMPORARY` | 1, 10, 500..504 | **Yes** | Unknown or internal VK server error. |
| `VkNetworkError` | `NETWORK` | - | **Yes** | Socket error, connection drop, DNS resolution failure. |
| `VkTimeoutError` | `TIMEOUT` | - | **Yes** | Request exceeded timeout duration. |

---

## Token Redaction in Error Traces

All error messages and `request_params` returned by VK are passed through a strict sanitizer that redacts any `access_token` parameter before instantiating the error object.
