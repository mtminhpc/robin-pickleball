/**
 * Sinh một `APP_SECRET` mới.
 *
 *   npm run new-secret
 *
 * Chỉ là một dòng, nhưng đáng có sẵn: hướng dẫn nào cũng bảo "sinh một chuỗi
 * ngẫu nhiên đủ dài" rồi để người dùng tự xoay xở, và cách xoay xở phổ biến nhất
 * là gõ đại một câu dễ nhớ — tức là một khoá đoán được.
 *
 * `APP_SECRET` ký cookie phân quyền. Ai đoán được nó thì tự cấp cho mình quyền
 * chủ sự kiện của mọi buổi đánh.
 */

import { randomBytes } from "node:crypto";

console.log(randomBytes(32).toString("base64url"));
