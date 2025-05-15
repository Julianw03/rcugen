import * as fs from "node:fs";
import {riotToOpenApiPrimitiveObjects, SimpleClient} from "./index.js";


interface HelpResponse {
    types: Record<string, any>,
    functions: Record<string, any>,
    events: Record<string, any>
}


interface ConsoleEnumType {
    values: {
        name: string;
        value: number;
    }[];
}

interface ConsoleObjectTypeEntry {
    description: string;
    offset: number;
    optional: boolean;
    type: ConsoleType;
}

interface ConsoleObjectType {
    fields: { [key: string]: ConsoleObjectTypeEntry }[];
}


type PrimitiveType = string;
type ArrayType = string;
type MapType = string;
type ConsoleType = ConsoleEnumType | ConsoleObjectType | PrimitiveType | ArrayType;

function isConsoleEnumType(type: ConsoleType): type is ConsoleEnumType {
    return (type as ConsoleEnumType).values !== undefined;
}

function isConsoleObjectType(type: ConsoleType): type is ConsoleObjectType {
    return (type as ConsoleObjectType).fields !== undefined;
}

function isPrimitiveType(type: ConsoleType): type is PrimitiveType {
    // @ts-ignore
    return typeof type === "string" && [...riotToOpenApiPrimitiveObjects.keys()].includes(type as string) && !isArrayType(type) && !isMapType(type);
}

function isArrayType(type: ConsoleType): type is ArrayType {
    return typeof type === "string" && type.startsWith("vector of");
}

function isMapType(type: ConsoleType): type is MapType {
    return typeof type === "string" && type.startsWith("map of");
}

interface ConsoleFunction {
    arguments: readonly object[];
    description?: string;
    help?: string;
    http_method?: string;
    url?: string;
    usage?: string;
}

interface ConsoleHelpResponse extends HelpResponse {
    types: Record<string, ConsoleType>;
}

export interface Event {
    description: string;
    name: string;
    nameSpace: string;
    tags: string[];
    type: {
        elementType: string;
        type: string;
    };
}

export interface Endpoint {
    arguments: {
        name: string;
        optional: boolean;
        type: {
            elementType: string;
            type: string;
        };
        description: string;
    }[];
    async: string;
    description: string;
    help: string;
    name: string;
    nameSpace: string;
    returns: {
        elementType: string;
        type: string;
    };
    tags: string[];
    threadSafe: boolean;
    method: string | null;
    path: string | null;
    pathParams: string[] | null;
}

export interface Type {
    name: string;
    values: {
        description: string;
        name: string;
        value: number;
    }[];
    fields: {
        description: string;
        name: string;
        offset: number;
        optional: boolean;
        type: {
            elementType: string;
            type: string;
        };
    }[];

    description: string;
    nameSpace: string;
    size: number;
    tags: string[];
}


export const createSchema = async (client: SimpleClient) => {

    const briefResponse = await client.request<HelpResponse>(
        "GET",
        "/help",
        null,
        {
            "format": "Brief"
        }
    );


    console.log("Fetching \"Console\" Format for types, functions and events");

    const consoleResponse = await client.request<ConsoleHelpResponse>(
        "GET",
        "/help",
        null,
        {
            "format": "Console"
        }
    )

    // console.log(JSON.stringify(consoleResponse, null, 2));

    const consoleTypes = Object.entries(consoleResponse.types);
    const schemas = someToOpenApiObject(consoleResponse.types);
    schemas.set("AnyType", {
            // @ts-ignore
            "nullable": true,
            "anyOf": [
                {
                    "type": "object",
                },
                {
                    "type": "string",
                },
                {
                    "type": "number",
                },
                {
                    "type": "boolean",
                },
                {
                    "type": "integer",
                },
                {
                    "type": "array",
                    "items": {}
                }
            ]
        }
    )

    fs.mkdirSync("./dist", {recursive: true});
    const schemaObject = Object.fromEntries(schemas);
    fs.writeFileSync("./dist/schemas.json", JSON.stringify(schemaObject, null, 2));
    return schemaObject;
}

type OpenApiPrimitive = {
    type: "string" | "number" | "integer" | "boolean" | "null"
    format?: string
}

interface OpenApiReference {
    $ref: string
}

interface OpenApiArray {
    type: "array"
    items: OpenApiType
}

interface OpenApiObject {
    type: "object"
    properties?: {
        [key: string]: OpenApiType
    }
    required?: string[]
    additionalProperties?: OpenApiType
    format?: string
}

interface OpenApiEnum {
    type: "string"
    enum: string[]
}

type OpenApiType = OpenApiPrimitive | OpenApiObject | OpenApiArray | OpenApiReference | OpenApiEnum;


const createRef = (name: string): OpenApiReference => {
    if (name === "" || name === " ") {
        console.warn("Name is empty, (most likely map / array resolve issue) using AnyType as default");
        name = "AnyType";
    } else if (isArrayType(name) || isMapType(name)) {
        console.warn("Nested type detected, using AnyType as default");
        name = "AnyType";
    } else if (name === '0') {
        console.warn("Name is 0, probably a type resolution issue, using AnyType as default");
        name = "AnyType";
    } else if (name == undefined || name == 'object') {
        console.warn(`Name is undefined or has an illegal value, using AnyType as default. Original name: ${name}`);
        name = "AnyType";
    }

    if (isPrimitiveType(name)) {
        return handlePrimitive(name) as OpenApiReference;
    }
    return {
        $ref: `#/components/schemas/${name}`
    }
}

const handleEnum = (value: ConsoleEnumType) => {
    const openApiEnumSpec: OpenApiEnum = {
        type: "string",
        enum: value.values.map((val) => val.name)
    }
    return openApiEnumSpec;
}

const handlePrimitive = (value: PrimitiveType) => {
    return riotToOpenApiPrimitiveObjects.get(value);
}



const handleArray = (value: ArrayType) => {
    const openApiArraySpec: OpenApiArray = {
        type: "array",
        items: createRef(value.substring("vector of ".length))
    }
    return openApiArraySpec;
}

const handleMap = (value: MapType) => {
    const openApiMapSpec: OpenApiObject = {
        type: "object",
        additionalProperties: createRef(value.substring("map of ".length))
    }
    return openApiMapSpec;
}

const handleObject = (value: ConsoleObjectType) => {

    const d = value.fields.map((field => {
        const [key, value] = Object.entries(field)[0];
        const type = value.type;

        let entry: string | OpenApiArray | OpenApiObject | OpenApiReference | OpenApiEnum;
        if (isConsoleEnumType(type)) {
            entry = handleEnum(type);
        } else if (isPrimitiveType(type)) {
            entry = handlePrimitive(type);
        } else if (isArrayType(type)) {
            entry = handleArray(type);
        } else if (isMapType(type)) {
            entry = handleMap(type);
        } else {
            entry = createRef(Object.keys(type)[0]);
        }

        return {[key]: entry};
    })).reduce((acc, curr) => {
        const [key, value] = Object.entries(curr)[0];
        // @ts-ignore
        acc[key] = value;
        return acc;
    }, {} as Record<string, OpenApiType>);

    const objectSpec: OpenApiObject = {
        type: "object",
        properties: d,
    }

    return objectSpec;
}

const someToOpenApiObject = (originalTypeMap: Record<string, ConsoleType>): Map<string, OpenApiType> => {
    const retMap = new Map<string, OpenApiType>();
    const handleEntry = ([key, value]: [string, ConsoleType]) => {
        let entry;
        if (isConsoleEnumType(value)) {
            entry = handleEnum(value);
        } else if (isPrimitiveType(value)) {
            entry = handlePrimitive(value);
        } else if (isArrayType(value)) {
            entry = handleArray(value);
        } else if (isConsoleObjectType(value)) {
            entry = handleObject(value);
        } else {
            entry = {
                type: "object",
                properties: {}
            }
        }
        retMap.set(key, entry);
    }
    Object.entries(originalTypeMap).forEach(handleEntry);
    return retMap;
}