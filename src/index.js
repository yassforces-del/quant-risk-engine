"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_server_1 = require("@hono/node-server");
const app_1 = require("./app");
(0, node_server_1.serve)({
    fetch: app_1.app.fetch,
    port: 3000
});
console.log('🚀 Quant Risk Engine ready');
