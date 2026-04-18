import { buildObjectUrl, getHostedContext } from "../lib/embed";

interface LinkToolbarProps {
  type: "report" | "dashboard";
  id: string;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function LinkToolbar({ type, id }: LinkToolbarProps) {
  const hostedContext = getHostedContext();
  const hosted = buildObjectUrl(type, id);
  const viewer = buildObjectUrl(type, id, { viewer: true });
  const embed = buildObjectUrl(type, id, { viewer: true, embed: true });

  if (hostedContext.embed) {
    return null;
  }

  return (
    <div className="link-toolbar">
      <button className="ghost-button" onClick={() => copyText(hosted)}>Copy link</button>
      <button className="ghost-button" onClick={() => window.open(viewer, "_blank", "noopener,noreferrer")}>Open full-screen</button>
      <button className="ghost-button" onClick={() => copyText(embed)}>Copy embed link</button>
    </div>
  );
}
