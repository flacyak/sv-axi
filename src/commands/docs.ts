import { EXIT, emit, emitError } from "../output.js";
import { parseFlags, type FlagSpec } from "../flags.js";
import { DOC_SECTIONS } from "../docs-index.js";

const DEFAULT_PKGS = ["svelte", "kit"];
const TRUNCATE_AT = 2000;

export const DOCS_FLAGS: FlagSpec[] = [
  { name: "pkg", takesValue: true },
  { name: "full", takesValue: false },
];

export const DOCS_HELP = `sv-axi docs — list and fetch official Svelte/SvelteKit documentation.

Usage:
  sv-axi docs                     list sections (svelte + kit by default)
  sv-axi docs <slug>              fetch one section from svelte.dev (live)
  sv-axi docs <pkg>/<slug>        disambiguate, e.g. kit/routing

Flags:
  --pkg <name>    limit the list to one package: svelte, kit, cli, ai
  --full          print the full section instead of the first ${TRUNCATE_AT} chars
  --help          show this help

Examples:
  sv-axi docs --pkg kit
  sv-axi docs \\$state
  sv-axi docs kit/load --full`;

function listSections(pkg: string | undefined): number {
  const pkgs = pkg ? [pkg] : DEFAULT_PKGS;
  const known = [...new Set(DOC_SECTIONS.map((s) => s.pkg))];
  if (pkg && !known.includes(pkg)) {
    return emitError(`unknown package \`${pkg}\``, {
      help: `valid packages: ${known.join(", ")}`,
      code: EXIT.USAGE,
    });
  }

  const rows = DOC_SECTIONS.filter((s) => pkgs.includes(s.pkg)).map((s) => ({
    slug: `${s.pkg}/${s.slug}`,
    title: s.title,
  }));

  emit({
    count: `${rows.length} of ${rows.length} total`,
    sections: rows,
    help: [
      "Run `sv-axi docs <slug>` to fetch a section (live from svelte.dev)",
      ...(pkg ? [] : ["Run `sv-axi docs --pkg cli` or `--pkg ai` for the other packages"]),
    ],
  });
  return EXIT.OK;
}

async function fetchSection(ref: string, full: boolean): Promise<number> {
  const [pkgPart, slugPart] = ref.includes("/")
    ? [ref.slice(0, ref.indexOf("/")), ref.slice(ref.indexOf("/") + 1)]
    : [undefined, ref];

  const matches = DOC_SECTIONS.filter(
    (s) => s.slug === slugPart && (pkgPart === undefined || s.pkg === pkgPart),
  );
  if (matches.length === 0) {
    return emitError(`unknown docs section \`${ref}\``, {
      help: "Run `sv-axi docs` to list valid slugs",
      code: EXIT.USAGE,
    });
  }
  if (matches.length > 1) {
    return emitError(`\`${ref}\` matches sections in more than one package`, {
      help: matches.map((m) => `Run \`sv-axi docs ${m.pkg}/${m.slug}\``),
      code: EXIT.USAGE,
    });
  }

  const section = matches[0];
  const url = `https://svelte.dev/docs/${section.pkg}/${encodeURIComponent(section.slug)}/llms.txt`;

  let text: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return emitError(`svelte.dev returned ${res.status} for ${section.pkg}/${section.slug}`, {
        help: "Run `npm run gen:docs` if the section index is stale, or retry later",
        code: EXIT.ERROR,
      });
    }
    text = await res.text();
  } catch {
    return emitError(`could not reach svelte.dev for ${section.pkg}/${section.slug}`, {
      help: "check network access and retry `sv-axi docs " + ref + "`",
      code: EXIT.ERROR,
    });
  }

  const truncated = !full && text.length > TRUNCATE_AT;
  const payload: Record<string, unknown> = {
    section: `${section.pkg}/${section.slug}`,
    title: section.title,
    content: truncated
      ? text.slice(0, TRUNCATE_AT) + `\n... (truncated, ${text.length} chars total)`
      : text,
  };
  if (truncated) {
    payload.help = [`Run \`sv-axi docs ${ref} --full\` for the complete section`];
  }
  emit(payload);
  return EXIT.OK;
}

/** `sv-axi docs` subcommand: static section index, live per-section fetch. */
export async function runDocs(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    emit({ help: DOCS_HELP });
    return EXIT.OK;
  }

  const parsed = parseFlags(args, DOCS_FLAGS);
  if (parsed.unknown) {
    return emitError(`unknown flag ${parsed.unknown} for \`docs\``, {
      help: "valid flags for `docs`: --pkg, --full (--help always allowed)",
      code: EXIT.USAGE,
    });
  }
  if (parsed.error) {
    return emitError(parsed.error, { help: DOCS_HELP, code: EXIT.USAGE });
  }
  if (parsed.positionals.length > 1) {
    return emitError("docs takes at most one section slug", {
      help: "sv-axi docs <slug>  e.g. `sv-axi docs kit/routing`",
      code: EXIT.USAGE,
    });
  }

  const slug = parsed.positionals[0];
  if (slug === undefined) return listSections(parsed.flags.pkg as string | undefined);
  return fetchSection(slug, parsed.flags.full === true);
}
