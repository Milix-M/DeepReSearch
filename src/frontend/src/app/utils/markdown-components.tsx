import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { Components } from "react-markdown";
import { mergeClassNames } from "./chat-helpers";

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
  children?: ReactNode;
};

export const markdownComponents: Components = {
  h1(props: ComponentPropsWithoutRef<"h1">) {
    const { children, className, ...rest } = props;
    return (
      <h2
        className={mergeClassNames("mt-6 text-xl font-semibold text-emerald-200", className)}
        {...rest}
      >
        {children}
      </h2>
    );
  },
  h2(props: ComponentPropsWithoutRef<"h2">) {
    const { children, className, ...rest } = props;
    return (
      <h3
        className={mergeClassNames("mt-6 text-lg font-semibold text-emerald-200", className)}
        {...rest}
      >
        {children}
      </h3>
    );
  },
  h3(props: ComponentPropsWithoutRef<"h3">) {
    const { children, className, ...rest } = props;
    return (
      <h4
        className={mergeClassNames("mt-5 text-base font-semibold text-emerald-100", className)}
        {...rest}
      >
        {children}
      </h4>
    );
  },
  h4(props: ComponentPropsWithoutRef<"h4">) {
    const { children, className, ...rest } = props;
    return (
      <h5
        className={mergeClassNames("mt-4 text-sm font-semibold text-emerald-100", className)}
        {...rest}
      >
        {children}
      </h5>
    );
  },
  p(props: ComponentPropsWithoutRef<"p">) {
    const { children, className, ...rest } = props;
    return (
      <p className={mergeClassNames("leading-relaxed text-emerald-100", className)} {...rest}>
        {children}
      </p>
    );
  },
  a(props: ComponentPropsWithoutRef<"a">) {
    const { children, className, ...rest } = props;
    return (
      <a
        className={mergeClassNames(
          "text-emerald-300 underline underline-offset-4 hover:text-emerald-200",
          className
        )}
        target="_blank"
        rel="noreferrer"
        {...rest}
      >
        {children}
      </a>
    );
  },
  ul(props: ComponentPropsWithoutRef<"ul">) {
    const { className, ...rest } = props;
    return (
      <ul
        className={mergeClassNames("ml-5 list-disc space-y-2 marker:text-emerald-300", className)}
        {...rest}
      />
    );
  },
  ol(props: ComponentPropsWithoutRef<"ol">) {
    const { className, ...rest } = props;
    return (
      <ol
        className={mergeClassNames("ml-5 list-decimal space-y-2 marker:text-emerald-300", className)}
        {...rest}
      />
    );
  },
  li(props: ComponentPropsWithoutRef<"li">) {
    const { children, className, ...rest } = props;
    return (
      <li className={mergeClassNames("leading-relaxed", className)} {...rest}>
        {children}
      </li>
    );
  },
  blockquote(props: ComponentPropsWithoutRef<"blockquote">) {
    const { children, className, ...rest } = props;
    return (
      <blockquote
        className={mergeClassNames(
          "border-l-2 border-emerald-400/70 pl-4 text-emerald-100/80",
          className
        )}
        {...rest}
      >
        {children}
      </blockquote>
    );
  },
  code({ inline, className, children, ...props }: MarkdownCodeProps) {
    if (inline) {
      return (
        <code className="rounded-md bg-slate-900/80 px-1.5 py-0.5 text-emerald-200" {...props}>
          {children}
        </code>
      );
    }
    return (
      <pre className="overflow-auto rounded-xl bg-slate-950/80 p-4 text-xs text-slate-100">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  table(props: ComponentPropsWithoutRef<"table">) {
    const { children, className, ...rest } = props;
    return (
      <div className="overflow-x-auto">
        <table
          className={mergeClassNames("w-full border-collapse text-sm", className)}
          {...rest}
        >
          {children}
        </table>
      </div>
    );
  },
  th(props: ComponentPropsWithoutRef<"th">) {
    const { children, className, ...rest } = props;
    return (
      <th
        className={mergeClassNames(
          "border border-slate-800 bg-slate-900/80 px-3 py-2 text-left font-semibold text-emerald-100",
          className
        )}
        {...rest}
      >
        {children}
      </th>
    );
  },
  td(props: ComponentPropsWithoutRef<"td">) {
    const { children, className, ...rest } = props;
    return (
      <td
        className={mergeClassNames("border border-slate-800 px-3 py-2 text-emerald-50", className)}
        {...rest}
      >
        {children}
      </td>
    );
  },
};
