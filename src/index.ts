import axios from "axios";
import * as https from "node:https";
import {createSchema} from "./schemas.js";
import {createPaths} from "./paths.js";
import * as fs from "node:fs";

export const riotToOpenApiPrimitiveObjects = new Map<string, any>();
riotToOpenApiPrimitiveObjects.set("string", {type: "string"});
riotToOpenApiPrimitiveObjects.set("int8", {type: "number", format: "int32"});
riotToOpenApiPrimitiveObjects.set("uint32", {type: "number", format: "int32"});
riotToOpenApiPrimitiveObjects.set("int32", {type: "number", format: "int32"});
riotToOpenApiPrimitiveObjects.set("uint64", {type: "number", format: "int64"});
riotToOpenApiPrimitiveObjects.set("int64", {type: "number", format: "int64"});
riotToOpenApiPrimitiveObjects.set("int", {type: "integer"});
riotToOpenApiPrimitiveObjects.set("double", {type: "number", format: "double"});
riotToOpenApiPrimitiveObjects.set("bool", {type: "boolean"});
riotToOpenApiPrimitiveObjects.set("null", {type: "null"});

export class SimpleClient {
    private static readonly localHttpsAgent = new https.Agent({
        rejectUnauthorized: false
    });

    private static generateAuthHeader = (secret: string) => {
        if (secret === undefined) throw new Error("Secret is undefined");
        return `Basic ${btoa("riot:" + secret)}`;
    }

    private static generateBaseUrl = (port: number) => {
        if (port === undefined) throw new Error("Port is undefined");
        return `https://127.0.0.1:${port}`;
    }

    readonly baseUrl: string;
    readonly authHeader: string;

    constructor(port: number, secret: string) {
        this.baseUrl = SimpleClient.generateBaseUrl(port);
        this.authHeader = SimpleClient.generateAuthHeader(secret);
    }

    async request<T>(
        method: "GET" | "POST" = "GET",
        endpoint: string,
        data?: any,
        params: any = {}
    ): Promise<T> {
        const response = await axios({
            method,
            url: `${this.baseUrl}${endpoint}`,
            httpsAgent: SimpleClient.localHttpsAgent,
            params: {
                ...params
            },
            headers: {
                "Authorization": this.authHeader
            },
            data
        });
        return response.data as T;
    }
}

async function run() {
    const port = parseInt(process.env.PORT);
    const secret = process.env.SECRET;

    const client = new SimpleClient(
        port,
        secret
    );


    const appInfo = await client.request("GET", "/riotclient/v1/app-info");

    const namePrefix = appInfo["name"];
    const version = appInfo["version"];
    const sdkVersion = appInfo["sdkVersion"];

    const schemas = await createSchema(client);
    const pathsOut = await createPaths(client);

    const openApiObject = {
        openapi: "3.0.0",
        info: {
            title: `${namePrefix} API`,
            version: version,
            description: `Created with SDK - Version ${sdkVersion}`
        },
        servers: [
            {
                url: client.baseUrl
            }
        ],
        paths: pathsOut,
        components: {
            securitySchemes: {
                basicAuth: {
                    type: "http",
                    scheme: "basic"
                }
            },
            responses: {
                UnauthorizedError: {
                    description: "Missing authentication credentials"
                },
                ForbiddenError: {
                    description: "Wrong authentication credentials"
                }
            },
            schemas: schemas
        },

        security: {
            basicAuth: []
        }
    }

    fs.mkdirSync("./out", {recursive: true});
    fs.writeFileSync("./out/openapi.json", JSON.stringify(openApiObject, null, 2));
}

run();