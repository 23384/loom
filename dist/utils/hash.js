"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shortHash = shortHash;
const crypto_1 = require("crypto");
function shortHash(input) {
    return (0, crypto_1.createHash)("sha256").update(input).digest("hex").slice(0, 16);
}
