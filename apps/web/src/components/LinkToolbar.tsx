import { buildObjectUrl } from "../lib/embed";

interface LinkToolbarProps {
  type: "report" | "dashboard";
  id: string;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function LinkToolbar({ type, id }: LinkToolbarProps) {
  const hosted = buildObjectUrl(type, id);
  const viewer = buildObjectUrl(type, id, { viewer: true });
  const embed = buildObjectUrl(type, id, { viewer: true, embed: true });

  return (
    <div className="link-toolbar">
      <button className="ghost-button" onClick={() => copyText(hosted)}>Copy link</button>
      <button className="ghost-button" onClick={() => window.open(viewer, "_blank", "noopener,noreferrer")}>Viewer</button>
      <button className="ghost-button" onClick={() => copyText(embed)}>Copy embed URL</button>
    </div>
  );
}
