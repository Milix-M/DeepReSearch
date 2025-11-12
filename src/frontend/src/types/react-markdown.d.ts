declare module "react-markdown" {
    import type { ComponentType, ReactNode } from "react";

    export type Components = Record<string, ComponentType<unknown>>;

    export interface ReactMarkdownProps {
        children?: ReactNode;
        components?: Components;
    }

    const ReactMarkdown: (props: ReactMarkdownProps) => JSX.Element;

    export default ReactMarkdown;
}
