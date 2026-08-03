/**
 * NavGator MCP Tool Definitions
 *
 * Each tool maps to existing NavGator programmatic APIs.
 * Responses are formatted as concise text for LLM consumption.
 */
export declare const TOOLS: ({
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            quick: {
                type: string;
                description: string;
            };
            content: {
                type: string;
                description: string;
            };
            component?: undefined;
            direction?: undefined;
            mode?: undefined;
            focus?: undefined;
            depth?: undefined;
            dir?: undefined;
            concurrency?: undefined;
            base?: undefined;
            record?: undefined;
        };
        required?: undefined;
    };
    annotations: {
        title: string;
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            quick?: undefined;
            content?: undefined;
            component?: undefined;
            direction?: undefined;
            mode?: undefined;
            focus?: undefined;
            depth?: undefined;
            dir?: undefined;
            concurrency?: undefined;
            base?: undefined;
            record?: undefined;
        };
        required?: undefined;
    };
    annotations: {
        title: string;
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            component: {
                type: string;
                description: string;
            };
            quick?: undefined;
            content?: undefined;
            direction?: undefined;
            mode?: undefined;
            focus?: undefined;
            depth?: undefined;
            dir?: undefined;
            concurrency?: undefined;
            base?: undefined;
            record?: undefined;
        };
        required: string[];
    };
    annotations: {
        title: string;
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            component: {
                type: string;
                description: string;
            };
            direction: {
                type: string;
                enum: string[];
                description: string;
            };
            quick?: undefined;
            content?: undefined;
            mode?: undefined;
            focus?: undefined;
            depth?: undefined;
            dir?: undefined;
            concurrency?: undefined;
            base?: undefined;
            record?: undefined;
        };
        required: string[];
    };
    annotations: {
        title: string;
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            mode: {
                type: string;
                enum: string[];
                description: string;
            };
            focus: {
                type: string;
                description: string;
            };
            quick?: undefined;
            content?: undefined;
            component?: undefined;
            direction?: undefined;
            depth?: undefined;
            dir?: undefined;
            concurrency?: undefined;
            base?: undefined;
            record?: undefined;
        };
        required?: undefined;
    };
    annotations: {
        title: string;
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            component: {
                type: string;
                description: string;
            };
            quick?: undefined;
            content?: undefined;
            direction?: undefined;
            mode?: undefined;
            focus?: undefined;
            depth?: undefined;
            dir?: undefined;
            concurrency?: undefined;
            base?: undefined;
            record?: undefined;
        };
        required?: undefined;
    };
    annotations: {
        title: string;
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            component: {
                type: string;
                description: string;
            };
            depth: {
                type: string;
                description: string;
            };
            quick?: undefined;
            content?: undefined;
            direction?: undefined;
            mode?: undefined;
            focus?: undefined;
            dir?: undefined;
            concurrency?: undefined;
            base?: undefined;
            record?: undefined;
        };
        required: string[];
    };
    annotations: {
        title: string;
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            dir: {
                type: string;
                description: string;
            };
            depth: {
                type: string;
                description: string;
            };
            concurrency: {
                type: string;
                description: string;
            };
            quick?: undefined;
            content?: undefined;
            component?: undefined;
            direction?: undefined;
            mode?: undefined;
            focus?: undefined;
            base?: undefined;
            record?: undefined;
        };
        required?: undefined;
    };
    annotations: {
        title: string;
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
} | {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            base: {
                type: string;
                description: string;
            };
            record: {
                type: string;
                description: string;
            };
            quick?: undefined;
            content?: undefined;
            component?: undefined;
            direction?: undefined;
            mode?: undefined;
            focus?: undefined;
            depth?: undefined;
            dir?: undefined;
            concurrency?: undefined;
        };
        required?: undefined;
    };
    annotations: {
        title: string;
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
})[];
export declare function handleToolCall(name: string, args: Record<string, unknown>): Promise<{
    content: Array<{
        type: string;
        text: string;
    }>;
    isError?: boolean;
}>;
//# sourceMappingURL=tools.d.ts.map