/** First descendant element with the given tag (light DOM only), like `querySelector(tag)`. */
export function firstDescendantByTag(root: Element | Document, tag: string): Element | null {
  return root.getElementsByTagName(tag)[0] ?? null;
}

/** Every descendant element of `root` in document order (light DOM only), like `querySelectorAll("*")`. */
export function descendantElements(root: ParentNode): Element[] {
  const out: Element[] = [];
  const visit = (parent: ParentNode): void => {
    for (const child of parent.children) {
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}
