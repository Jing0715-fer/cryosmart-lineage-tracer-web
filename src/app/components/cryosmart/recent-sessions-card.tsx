"use client";

import { useRecentSessions, removeSession, clearSessions, formatRelativeTime, type RecentSession } from "@/lib/cryosmart/recent-sessions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, Trash2, X, UploadCloud, Server, Bookmark, FlaskConical, ArrowRight } from "lucide-react";

interface Props {
  onReload: (session: RecentSession) => void;
}

const SOURCE_CONFIG = {
  upload: { icon: <UploadCloud className="h-3 w-3" />, label: "Upload", color: "text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300" },
  live: { icon: <Server className="h-3 w-3" />, label: "Live", color: "text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300" },
  bookmarklet: { icon: <Bookmark className="h-3 w-3" />, label: "Bookmark", color: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300" },
  sample: { icon: <FlaskConical className="h-3 w-3" />, label: "Sample", color: "text-teal-700 bg-teal-50 dark:bg-teal-950 dark:text-teal-300" },
} as const;

export function RecentSessionsCard({ onReload }: Props) {
  const sessions = useRecentSessions();

  if (sessions.length === 0) {
    return null; // Don't render the card if there's nothing to show.
  }

  return (
    <Card className="border-dashed bg-slate-50/40 dark:bg-slate-900/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <History className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <CardTitle className="text-[13px]">Recent Sessions</CardTitle>
            <Badge variant="secondary" className="ml-1 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {sessions.length}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-slate-500 hover:text-rose-600"
            onClick={clearSessions}
            title="Clear all recent sessions"
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Clear all
          </Button>
        </div>
        <CardDescription className="text-[11.5px]">
          Stored locally in your browser. Click any session to re-load it (you&apos;ll need to re-run the bookmarklet or re-upload for live/upload sources).
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="max-h-44">
          <div className="space-y-1.5">
            {sessions.map((s) => {
              const cfg = SOURCE_CONFIG[s.source];
              return (
                <div
                  key={s.id}
                  className="group flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 transition-colors hover:border-teal-300 hover:bg-teal-50/30 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-teal-700 dark:hover:bg-teal-950/30"
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${cfg.color}`}>
                    {cfg.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px] font-bold text-slate-800 dark:text-slate-100">{s.projectUid}</span>
                      {s.startJob && (
                        <>
                          <ArrowRight className="h-2.5 w-2.5 text-slate-400" />
                          <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{s.startJob}</span>
                        </>
                      )}
                      <Badge variant="outline" className={`ml-1 px-1.5 py-0 text-[9px] ${cfg.color}`}>
                        {cfg.label}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                      <span>{s.jobCount.toLocaleString()} jobs</span>
                      <span>·</span>
                      <span>{formatRelativeTime(s.createdAt)}</span>
                      {s.cryosmartOrigin && (
                        <>
                          <span>·</span>
                          <span className="truncate font-mono">{s.cryosmartOrigin.replace(/^https?:\/\//, "")}</span>
                        </>
                      )}
                      {s.fileName && (
                        <>
                          <span>·</span>
                          <span className="truncate">{s.fileName}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-[11px] text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-400 dark:hover:bg-teal-950"
                    onClick={() => onReload(s)}
                  >
                    Reload
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-slate-400 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100"
                    onClick={() => removeSession(s.id)}
                    title="Remove this session"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
