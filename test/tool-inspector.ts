import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi:ExtensionAPI){pi.registerCommand("inspect-mesh-tools",{handler:async(_args,ctx)=>ctx.ui.notify(JSON.stringify(pi.getAllTools().map(t=>t.name).filter(n=>n.startsWith("agent_mesh_")).sort()),"info")})}
