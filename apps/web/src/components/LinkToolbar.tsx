import { buildObjectUrl, getHostedContext } from "../lib/embed";
import { useLocation } from "react-router-dom";

interface LinkToolbarProps {
  type: "report" | "dashboard";
  id: string;
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function LinkToolbar({ type, id }: LinkToolbarProps) {
  const location = useLocation();
  const hostedContext = getHostedContext();
  const hosted = buildObjectUrl(type, id);
  const viewer = buildObjectUrl(type, id, { viewer: true });
  const embed = buildObjectUrl(type, id, { viewer: true, embed: true });
  const alreadyFullScreen = /^\/(report|dashboard)\//.test(location.pathname);

  if (hostedContext.embed) {
    return null;
  }

  return (
    <div className="link-toolbar">
      <button className="ghost-button btn-system" onClick={() => copyText(hosted)}>Copy link</button>
      {alreadyFullScreen ? null : (
        <button className="ghost-button btn-system" onClick={() => window.open(viewer, "_blank", "noopener,noreferrer")}>Open full-screen</button>
      )}
      <button className="ghost-button btn-system" onClick={() => copyText(embed)}>Copy embed link</button>
    </div>
  );
}
