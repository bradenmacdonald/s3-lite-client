/**
 * Basic XML parser for Deno
 * https://github.com/nekobato/deno-xml-parser
 * By Hayato Koriyama, MIT licensed
 * Based on https://github.com/segmentio/xml-parser (MIT licensed)
 * "Simple non-compliant XML parser because we just need to parse some basic responses"
 */

export interface Xml {
  name: string;
  attributes: Record<string, string>;
  content?: string;
  children: Xml[];
}

/**
 * Get the text content of the first child element with the given name, if there is one.
 */
export function childText(node: Xml, name: string): string | undefined {
  return node.children.find((c) => c.name === name)?.content;
}

/**
 * Parse the given string of `xml` and return its root element, if it has one.
 */
export function parse(xml: string): Xml | undefined {
  xml = xml.trim();

  // strip comments
  xml = xml.replace(/<!--[\s\S]*?-->/g, "");

  // skip the declaration, e.g. <?xml version="1.0" encoding="UTF-8"?> - we never look at it
  match(/^<\?xml[\s\S]*?\?>\s*/);

  return tag();

  /**
   * Tag.
   */
  function tag() {
    const m = match(/^<([\w-:.]+)\s*/);
    if (!m) return;

    // name
    const node: Xml = {
      name: m[1],
      attributes: {},
      children: [],
    };

    // attributes
    while (!(eos() || is(">") || is("?>") || is("/>"))) {
      const attr = attribute();
      if (!attr) return node;
      node.attributes[attr.name] = attr.value;
    }

    // self closing tag
    if (match(/^\s*\/>\s*/)) {
      return node;
    }

    match(/\??>\s*/);

    // content
    node.content = content();

    // children
    let child;
    while ((child = tag())) {
      node.children.push(child);
    }

    // closing
    match(/^<\/[\w-:.]+>\s*/);

    return node;
  }

  /**
   * Text content.
   */
  function content() {
    const m = match(/^([^<]*)/);
    if (m) return entities(m[1]);
    return "";
  }

  /**
   * Attribute.
   */
  function attribute() {
    const m = match(/([\w:-]+)\s*=\s*("[^"]*"|'[^']*'|\w+)\s*/);
    if (!m) return;
    return { name: m[1], value: entities(strip(m[2])) };
  }

  /**
   * Strip quotes from `val`.
   */
  function strip(val: string) {
    return val.replace(/^['"]|['"]$/g, "");
  }

  /** Basic handling of entities: &amp; &lt; &gt; */
  function entities(val: string) {
    return val.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  }

  /**
   * Match `re` and advance the string.
   */
  function match(re: RegExp) {
    const m = xml.match(re);
    if (!m) return;
    xml = xml.slice(m[0].length);
    return m;
  }

  /**
   * End-of-source.
   */
  function eos() {
    return xml.length === 0;
  }

  /**
   * Check for `prefix`.
   */
  function is(prefix: string) {
    return xml.startsWith(prefix);
  }
}
