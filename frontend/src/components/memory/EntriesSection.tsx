"use client";

import { useCallback, useState, type FormEvent } from "react";
import { buttonStyles } from "@/components/ui/MagneticButton";
import { Badge, Empty, ErrorBox, Loading, PaperLine, SOURCE_LABEL, VERIFICATION_LABEL, inputCls, labelCls, verificationTone, when } from "@/components/memory/ui";
import { useAction, useRemote } from "@/hooks/useRemote";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { MemoryEntry, MemoryType } from "@/types/memory";
import type { Paper } from "@/types/paper";

interface Props {
  projectId: number;
  memoryType: MemoryType;
  version: number;
  onChanged: () => void;
  fields: { value: string; label: string }[];
  papers?: Paper[];
  intro: string;
}

function EntryCard({ entry, projectId, onChanged }: { entry: MemoryEntry; projectId: number; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.content);
  const { run, busy, error } = useAction(onChanged);
  const rejected = entry.verification_status === "rejected";
  const act = (body: Parameters<typeof api.memory.patchEntry>[2]) => run(() => api.memory.patchEntry(projectId, entry.id, body));
  return (
    <li className={cn("min-w-0 rounded-xl border border-line-strong bg-white/[0.02] p-4", rejected && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">{SOURCE_LABEL[entry.source_type]}</Badge>
        <Badge tone={verificationTone(entry.verification_status)}>{VERIFICATION_LABEL[entry.verification_status]}</Badge>
        <span className="text-[11px] uppercase tracking-wider text-muted">{entry.field.replace(/_/g, " ")}</span>
      </div>
      {editing ? (
        <div className="mt-3">
          <label className={labelCls} htmlFor={`edit-${entry.id}`}>Edit entry {entry.id}</label>
          <textarea id={`edit-${entry.id}`} className={cn(inputCls, "min-h-20")} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      ) : (
        <p className={cn("mt-2 text-sm [overflow-wrap:anywhere]", rejected && "line-through")}>{entry.content}</p>
      )}
      {entry.matched_text && (
        <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-xs text-slate-300 [overflow-wrap:anywhere]">
          <span className="block text-[10px] uppercase tracking-wider text-muted">Source text{entry.section_name ? ` (${entry.section_name})` : ""}</span>
          “{entry.matched_text}”
        </blockquote>
      )}
      <div className="mt-2 space-y-1">
        <PaperLine paper={entry.paper} />
        {entry.source_reference && <p className="text-xs text-muted [overflow-wrap:anywhere]">Source: {entry.source_reference}</p>}
        {entry.extraction_method && (
          <p className="text-xs text-muted [overflow-wrap:anywhere]">
            Method: {entry.extraction_method} · extracted {when(entry.extracted_at)}
            {entry.confidence !== null ? ` · confidence ${entry.confidence}` : " · no confidence score (rule match)"}
          </p>
        )}
      </div>
      <ErrorBox message={error} />
      <div className="mt-3 flex flex-wrap gap-2">
        {editing ? (
          <>
            <button type="button" disabled={busy || !text.trim()} className={cn(buttonStyles("primary"), "min-h-10 !px-4 !py-1.5 text-xs")}
              onClick={async () => { if ((await act({ content: text })) !== undefined) setEditing(false); }}>Save edit</button>
            <button type="button" className={cn(buttonStyles("ghost"), "min-h-10 !py-1.5 text-xs")} onClick={() => { setEditing(false); setText(entry.content); }}>Cancel</button>
          </>
        ) : (
          <>
            {!["confirmed", "edited"].includes(entry.verification_status) && !rejected && (
              <button type="button" disabled={busy} className={cn(buttonStyles("ghost"), "min-h-10 !py-1.5 text-xs")} onClick={() => act({ verification_status: "confirmed" })}>Confirm</button>
            )}
            {!rejected && <button type="button" disabled={busy} className={cn(buttonStyles("ghost"), "min-h-10 !py-1.5 text-xs")} onClick={() => act({ verification_status: "rejected" })}>Reject</button>}
            {rejected && <button type="button" disabled={busy} className={cn(buttonStyles("ghost"), "min-h-10 !py-1.5 text-xs")} onClick={() => act({ verification_status: "unverified" })}>Restore</button>}
            <button type="button" disabled={busy} className={cn(buttonStyles("ghost"), "min-h-10 !py-1.5 text-xs")} onClick={() => setEditing(true)}>Edit</button>
          </>
        )}
      </div>
    </li>
  );
}

function AddEntry({ projectId, memoryType, fields, papers, onChanged }: Pick<Props, "projectId" | "memoryType" | "fields" | "papers" | "onChanged">) {
  const [field, setField] = useState(fields[0].value);
  const [content, setContent] = useState("");
  const [paperId, setPaperId] = useState("");
  const { run, busy, error } = useAction(onChanged);
  const needsPaper = memoryType === "literature";
  async function submit(e: FormEvent) {
    e.preventDefault();
    const out = await run(() => api.memory.createEntry(projectId, { memory_type: memoryType, field, content: content.trim(), ...(paperId ? { paper_id: Number(paperId) } : {}) }));
    if (out) setContent("");
  }
  return (
    <form onSubmit={submit} className="grid min-w-0 gap-3 rounded-xl border border-line-strong p-4" aria-label="Add memory entry">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label className={labelCls} htmlFor={`f-${memoryType}`}>Type</label>
          <select id={`f-${memoryType}`} className={inputCls} value={field} onChange={(e) => setField(e.target.value)}>
            {fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        {needsPaper && (
          <div className="min-w-0">
            <label className={labelCls} htmlFor="entry-paper">Paper</label>
            <select id="entry-paper" className={inputCls} value={paperId} onChange={(e) => setPaperId(e.target.value)} required>
              <option value="">Choose a saved paper…</option>
              {(papers ?? []).map((p) => <option key={p.id} value={p.id}>{p.title.slice(0, 90)}</option>)}
            </select>
          </div>
        )}
      </div>
      <div>
        <label className={labelCls} htmlFor={`c-${memoryType}`}>Your entry</label>
        <textarea id={`c-${memoryType}`} className={cn(inputCls, "min-h-20")} value={content} onChange={(e) => setContent(e.target.value)} maxLength={4000} />
      </div>
      <ErrorBox message={error} />
      <button type="submit" disabled={busy || !content.trim() || (needsPaper && !paperId)} className={cn(buttonStyles("primary"), "min-h-11 justify-self-start disabled:opacity-50")}>Add entry</button>
    </form>
  );
}

export function EntriesSection(props: Props) {
  const { projectId, memoryType, version, onChanged, intro } = props;
  const load = useCallback(() => api.memory.entries(projectId, { memory_type: memoryType }), [projectId, memoryType]);
  const { data, error, loading } = useRemote(load, version);
  const items = data?.items ?? [];
  const byPaper = new Map<string, MemoryEntry[]>();
  for (const e of items) byPaper.set(e.paper ? `p${e.paper.id}` : "none", [...(byPaper.get(e.paper ? `p${e.paper.id}` : "none") ?? []), e]);
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">{intro}</p>
      <ErrorBox message={error} />
      {loading ? <Loading label="Loading entries" /> : items.length === 0 && !error ? (
        <Empty>No entries yet. Use “Rebuild memory” on the Overview tab or add one below.</Empty>
      ) : (
        [...byPaper.entries()].map(([key, list]) => (
          <section key={key} className="space-y-3" aria-label={list[0].paper ? `Entries for ${list[0].paper.title}` : "Entries"}>
            {list[0].paper && <h3 className="text-sm font-medium [overflow-wrap:anywhere]">{list[0].paper.title}</h3>}
            <ul className="space-y-3">{list.map((e) => <EntryCard key={e.id} entry={e} projectId={projectId} onChanged={onChanged} />)}</ul>
          </section>
        ))
      )}
      {data && data.total > items.length && <p className="text-xs text-muted">Showing {items.length} of {data.total} entries.</p>}
      <AddEntry {...props} />
    </div>
  );
}
