/**
 * LLM Call Tracer
 *
 * Anchor-based detection of AI/LLM API calls in source code.
 * Instead of searching for "prompt-like" patterns everywhere,
 * starts from unambiguous API call sites and traces backwards
 * to find the provider, model, prompt content, and configuration.
 *
 * 4-pass approach:
 *   Pass 1: Find SDK imports & client initializations
 *   Pass 2: Find API call sites (anchors)
 *   Pass 3: Map wrapper functions
 *   Pass 4: Extract call arguments (model, messages, config)
 */
import { ScanResult } from '../../types.js';
export interface TracedLLMCall {
    id: string;
    name: string;
    anchor: {
        file: string;
        line: number;
        code: string;
        method: string;
    };
    provider: {
        name: string;
        sdk: string;
        importLine: number;
        clientVariable: string;
    };
    model: {
        value: string | null;
        isDynamic: boolean;
        variableName?: string;
        line: number;
    };
    prompt: {
        type: 'messages-array' | 'string-prompt' | 'template' | 'variable-ref';
        content?: string;
        systemPrompt?: string;
        hasUserTemplate: boolean;
        variables: string[];
        definitionFile?: string;
        definitionLine?: number;
    };
    config: {
        temperature?: number;
        maxTokens?: number;
        stream?: boolean;
        tools?: string[];
    };
    callType: 'chat' | 'completion' | 'embedding' | 'image' | 'audio' | 'function-call';
    confidence: number;
}
/** An API call site found in the code */
interface CallAnchor {
    file: string;
    line: number;
    code: string;
    method: string;
    clientVariable: string;
    providerName: string;
    sdk: string;
    callType: TracedLLMCall['callType'];
    containingFunction?: string;
}
/** A wrapper function that contains an SDK call */
interface WrapperFunction {
    file: string;
    functionName: string;
    className?: string;
    exportedAs?: string;
    containedAnchors: CallAnchor[];
    hasTraceable: boolean;
}
export interface LLMTraceResult {
    calls: TracedLLMCall[];
    wrappers: WrapperFunction[];
    scanResult: ScanResult;
}
export declare function traceLLMCalls(projectRoot: string, walkSet?: Set<string>): Promise<LLMTraceResult>;
export {};
//# sourceMappingURL=llm-call-tracer.d.ts.map