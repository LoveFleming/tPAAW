import React from "react";
import { CodeBlock } from "../ui/shared";

export default function JsonSchemaViewer({ schema }: { schema: any }) {
    if (!schema) return null;

    return (
        <div className="bg-slate-900 rounded-md overflow-hidden">
            <CodeBlock text={JSON.stringify(schema, null, 2)} />
        </div>
    );
}
