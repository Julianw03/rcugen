import {riotToOpenApiPrimitiveObjects, SimpleClient} from "./index.js";

export const createPaths = async (
    client: SimpleClient,
    objectNameOverrides: Record<string, string> = {}
) => {
    const createType = (some: any) => {
        if (typeof some === "string") {
            console.log("Creating type for: " + some);
            if (some.startsWith("vector of")) {
                return {
                    type: "array",
                    items: createType(some.substring("vector of ".length))
                }
            } else if (some.startsWith("map of")) {
                return {
                    type: "object",
                    additionalProperties: createType(some.substring("map of ".length))
                }
            } else if (some === "object" || some === " " || some === "") {
                return {
                    $ref: "#/components/schemas/AnyType"
                }
            }

            const f = riotToOpenApiPrimitiveObjects.get(some);
            if (f !== undefined) {
                return f;
            }
        } else {
            some = Object.keys(some)[0];
            console.log("Creating type for: " + some);
        }


        some = objectNameOverrides[some] || some;

        if (some === "0") {
            some = "AnyType";
        }
        return {
            "$ref": "#/components/schemas/" + some
        }
    }

    const consoleHelp = await client.request<any>(
        "GET",
        "/help",
        null,
        {
            format: "Console"
        }
    );

    const fullHelp = await client.request<any>(
        "GET",
        "/help",
        null,
        {
            format: "Full"
        }
    )

    // console.log(consoleHelp.functions);
    // console.log(JSON.stringify(fullHelp.functions, null, 2));
    const someObject = {}
    const arr = fullHelp.functions as any[];
    arr.map((item) => {
        const assocHelp = consoleHelp.functions[item.name];
        const urlString = assocHelp?.url?.replace("{+path}", "{path}");
        if (urlString === undefined) {
            console.log("No URL found for " + item.name);
            return;
        }

        let entry = someObject[urlString];
        if (entry === undefined) {
            entry = someObject[urlString] = {};
        }

        let tags = item.tags.filter((tag => tag !== "$remoting-binding-module" && tag !== "Plugins"));
        if (tags.length === 0) {
            tags = ["core-sdk"];
        }

        const httpMethod = assocHelp.http_method.toLowerCase();
        entry[httpMethod] = entry[httpMethod] || {};
        entry[httpMethod]["tags"] = tags;
        entry[httpMethod]["description"] = `${item.description} ${item.help ? "\n [Help] " + item.help : ""}`

        const responses = {};
        const parameters = [];
        const deprecated = item.deprecated
            || (item.description?.toLowerCase()?.includes("deprecated") ?? false)
            || (item.help?.toLowerCase()?.includes("deprecated") ?? false);

        entry[httpMethod]["parameters"] = parameters;
        entry[httpMethod]["responses"] = responses;

        const fullParamLookup = createLookupMapFromFullArguments(item.arguments);
        const consoleParamLookup = createLookupMapFromConsoleArguments(assocHelp.arguments);
        const paramToLocation = {};

        const usage = assocHelp.usage;
        let params = [];
        console.log(httpMethod + " " + urlString);

        let requestBody = null;

        if (usage !== undefined) {
            params = usage.split(" ").slice(1);
            params.forEach((param => {
                let paramName = param.trim();
                if (paramName.startsWith("[") && paramName.endsWith("]")) {
                    paramName = paramName.slice(1, -1);
                    if (paramName.startsWith("<") && paramName.endsWith(">")) {
                        paramName = paramName.slice(1, -1);
                        paramToLocation[paramName] = "query";
                    } else {
                        paramToLocation[paramName] = "query";
                    }
                } else if (paramName.startsWith("<") && paramName.endsWith(">")) {
                    paramName = paramName.slice(1, -1);
                    //Sometimes path params are noted like {+path}
                    if (assocHelp.url.replace('+', '').includes("{" + paramName + "}") || assocHelp.http_method === "DELETE" || assocHelp.http_method === "GET") {
                        paramToLocation[paramName] = "path";
                    } else {
                        paramToLocation[paramName] = "body";
                    }
                } else {
                    console.log("Unknown param: " + paramName);
                    return;
                }

                const arg = consoleParamLookup[paramName];
                if (arg === undefined) {
                    console.log("Argument not found: " + paramName);
                    return;
                }

                const location = paramToLocation[paramName];
                if (location === undefined) {
                    return;
                }

                const schemaType = createType(arg.type);
                switch (location) {
                    case "path":
                        arg.optional = false;
                    case "query":
                        const obj = {
                            in: location,
                            name: paramName,
                            description: arg.description,
                            schema: schemaType
                        }

                        if (arg.optional === false) {
                            obj["required"] = true;
                        }

                        parameters.push(
                            obj
                        );
                        break;
                    case "body":
                        requestBody = {
                            "description": arg.description,
                            "content": {
                                "application/json": {
                                    schema: schemaType
                                }
                            }
                        }
                }

                const required = arg.optional === false;
                console.log(paramToLocation[paramName] + " " + paramName);
                console.log("-> " + JSON.stringify(schemaType) + " " + paramName + (required ? "" : " (optional)"));
            }));


            if (requestBody !== null) {
                entry[httpMethod]["requestBody"] = requestBody;
            }

            if (deprecated) {
                entry[httpMethod]["deprecated"] = true;
            }

            const returns = assocHelp.returns;
            if (returns === undefined) {
                responses["2XX"] = {
                    description: "Returns nothing"
                };
                console.log("==> void")
            } else if (typeof returns === "string") {
                responses["2XX"] = {
                    description: "Success",
                    content: {
                        "application/json": {
                            schema: createType(returns)
                        }
                    }
                };
            } else {
                const returnType = Object.keys(returns)[0];
                console.log("==> Ref: " + returnType);

                responses["2XX"] = {
                    description: "Success",
                    content: {
                        "application/json": {
                            schema: createType(returns)
                        }
                    }
                };
            }
        }

        responses["401"] = {
            '$ref': '#/components/responses/UnauthorizedError'
        };

        console.log("========================================");
    });

    return someObject;
}

const createLookupMapFromConsoleArguments = (args: any[]) => {
    return args.reduce((acc, current) => {
        const entry = Object.entries(current)[0];
        acc[entry[0]] = entry[1];
        return acc;
    }, {});
}

const createLookupMapFromFullArguments = (args: any[]) => {
    return args.reduce((acc, current) => {
        const name = current.name;
        if (name === undefined) {
            console.error("Name is undefined for argument: " + JSON.stringify(current));
            return acc;
        }
        acc[name] = current;
        return acc;
    }, {})
}
