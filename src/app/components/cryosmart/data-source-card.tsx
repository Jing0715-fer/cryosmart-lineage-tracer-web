"use client";

import { useCallback, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  UploadCloud,
  FileJson,
  Server,
  Plug,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FlaskConical,
  ExternalLink,
} from "lucide-react";
import { loadSession, saveSession, fetchProjectJobs, type CryoSmartSession } from "@/lib/cryosmart/proxy-client";
import { buildSampleExportedMetadata } from "@/lib/cryosmart/sample-data";

export interface LoadedMetadata {
  /** Either raw array of jobs or { jobs: [...] }. */
  raw: unknown;
  projectUid: string;
  jobCount: number;
  source: "upload" | "sample" | "live";
  session?: CryoSmartSession | null;
  /** When source is "live", a list of job uids discovered. */
  liveJobUids?: string[];
}

interface Props {
  loaded: LoadedMetadata | null;
  onLoad: (loaded: LoadedMetadata) => void;
}

export function DataSourceCard({ loaded, onLoad }: Props) {
  return (
    <Card id="data-source" className="scroll-mt-20 overflow-hidden">
      <CardHeader className="bg-gradient-to-br from-slate-50 to-teal-50/40 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-[13px] font-bold text-white">1</span>
              <CardTitle className="text-lg">Choose a Data Source</CardTitle>
            </div>
            <CardDescription className="mt-1.5 pl-9 text-[13px]">
              The original Chrome extension scraped CryoSmart&apos;s DOM via an injected content script. A web app on a different origin cannot do that — so we offer three paths that work in every browser.
            </CardDescription>
          </div>
          {loaded && (
            <Badge variant="secondary" className="gap-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {loaded.source === "upload" ? "JSON loaded" : loaded.source === "sample" ? "Sample loaded" : "Live connected"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-4">
        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-slate-100">
            <TabsTrigger value="upload" className="text-[13px] data-[state=active]:bg-white">
              <FileJson className="mr-1.5 h-3.5 w-3.5" /> Upload JSON
            </TabsTrigger>
            <TabsTrigger value="live" className="text-[13px] data-[state=active]:bg-white">
              <Server className="mr-1.5 h-3.5 w-3.5" /> Live Connect
            </TabsTrigger>
            <TabsTrigger value="sample" className="text-[13px] data-[state=active]:bg-white">
              <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Try Sample
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-4">
            <UploadJsonPanel loaded={loaded} onLoad={onLoad} />
          </TabsContent>
          <TabsContent value="live" className="mt-4">
            <LiveConnectPanel loaded={loaded} onLoad={onLoad} />
          </TabsContent>
          <TabsContent value="sample" className="mt-4">
            <SamplePanel loaded={loaded} onLoad={onLoad} />
          </TabsContent>
        </Tabs>

        {loaded && (
          <>
            <Separator className="my-4" />
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-[12px]">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="text-slate-500">Loaded:</span>
                <span className="font-mono text-slate-700">project = {loaded.projectUid}</span>
                <span className="font-mono text-slate-700">jobs = {loaded.jobCount}</span>
                <span className="font-mono text-slate-700">source = {loaded.source}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UploadJsonPanel({ loaded, onLoad }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setParsing(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      let jobs: unknown[] = [];
      let projectUid = "P";
      if (Array.isArray(json)) {
        jobs = json;
      } else if (json && typeof json === "object") {
        const obj = json as Record<string, unknown>;
        if (Array.isArray(obj.jobs)) jobs = obj.jobs;
        if (typeof obj.project_uid === "string") projectUid = obj.project_uid;
      }
      if (jobs.length === 0) {
        throw new Error("No jobs array found in JSON.");
      }
      onLoad({
        raw: json,
        projectUid,
        jobCount: jobs.length,
        source: "upload",
      });
      toast.success(`Loaded ${jobs.length} jobs from ${file.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to parse JSON: ${msg}`);
    } finally {
      setParsing(false);
    }
  }, [onLoad]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragOver ? "border-teal-400 bg-teal-50" : "border-slate-300 bg-slate-50/50 hover:border-teal-300 hover:bg-teal-50/40"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-600">
          {parsing ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
        </div>
        <p className="text-[13px] font-medium text-slate-700">
          {parsing ? "Parsing…" : "Drop the CryoSmart metadata JSON here, or click to browse"}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Accepts a top-level array of jobs, or <code className="rounded bg-slate-200 px-1 py-0.5 text-[10px]">{"{ jobs: [...] }"}</code> wrapper
        </p>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-[11.5px] text-amber-800">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-medium">How to get this JSON?</span> Use the original Chrome extension&apos;s
            <span className="mx-1 font-mono rounded bg-amber-100 px-1">可选：导出当前 Project 全部 metadata</span>
            button, OR fetch <code className="rounded bg-amber-100 px-1">/api/projects/&lt;pid&gt;/jobs</code> from CryoSmart directly. See the <a href="#help" className="underline">Help section</a> below.
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveConnectPanel({ loaded, onLoad }: Props) {
  const existing = loadSession();
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl || "http://192.168.4.3:8080");
  const [cookie, setCookie] = useState(existing?.cookie || "");
  const [auth, setAuth] = useState(existing?.auth || "");
  const [projectId, setProjectId] = useState("P52");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const testConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const session: CryoSmartSession = { baseUrl: baseUrl.replace(/\/+$/, ""), cookie: cookie || undefined, auth: auth || undefined };
      saveSession(session);
      const result = await fetchProjectJobs(session, projectId);
      setTestResult({ ok: true, msg: `OK — found ${result.jobs.length} jobs via ${result.source}` });
      toast.success(`Connected: ${result.jobs.length} jobs found`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, msg });
      toast.error(`Connection failed: ${msg}`);
    } finally {
      setTesting(false);
    }
  }, [baseUrl, cookie, auth, projectId]);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const session: CryoSmartSession = { baseUrl: baseUrl.replace(/\/+$/, ""), cookie: cookie || undefined, auth: auth || undefined };
      saveSession(session);
      const result = await fetchProjectJobs(session, projectId);
      const jobUids: string[] = [];
      for (const j of result.jobs as Array<Record<string, unknown>>) {
        if (typeof j.uid === "string") jobUids.push(j.uid);
        else if (typeof j.uid_num === "number") jobUids.push(`J${j.uid_num}`);
      }
      jobUids.sort();
      onLoad({
        raw: { jobs: result.jobs },
        projectUid: projectId,
        jobCount: result.jobs.length,
        source: "live",
        session,
        liveJobUids: jobUids,
      });
      toast.success(`Loaded ${result.jobs.length} jobs from ${session.baseUrl}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Load jobs failed: ${msg}`);
    } finally {
      setLoadingJobs(false);
    }
  }, [baseUrl, cookie, auth, projectId, onLoad]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cryosmart-base" className="text-[12px] text-slate-600">CryoSmart Base URL</Label>
          <Input
            id="cryosmart-base"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://192.168.4.3:8080"
            className="h-9 font-mono text-[13px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cryosmart-cookie" className="text-[12px] text-slate-600">Session Cookie <span className="text-slate-400">(optional)</span></Label>
          <Input
            id="cryosmart-cookie"
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="session=eyJ...; csrftoken=abc"
            className="h-9 font-mono text-[12px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cryosmart-auth" className="text-[12px] text-slate-600">Authorization <span className="text-slate-400">(optional)</span></Label>
          <Input
            id="cryosmart-auth"
            value={auth}
            onChange={(e) => setAuth(e.target.value)}
            placeholder="Bearer eyJ..."
            className="h-9 font-mono text-[12px]"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cryosmart-pid" className="text-[12px] text-slate-600">Project ID</Label>
          <Input
            id="cryosmart-pid"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="P52"
            className="h-9 font-mono text-[13px]"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={testConnection} disabled={testing || !baseUrl} className="h-8 text-[12px]">
          {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1.5 h-3.5 w-3.5" />}
          Test connection
        </Button>
        <Button size="sm" onClick={loadJobs} disabled={loadingJobs || !baseUrl || !projectId} className="h-8 text-[12px] bg-teal-600 hover:bg-teal-700">
          {loadingJobs ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Server className="mr-1.5 h-3.5 w-3.5" />}
          Load jobs
        </Button>
      </div>

      {testResult && (
        <div className={`flex items-start gap-2 rounded-md border p-2.5 text-[12px] ${testResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
          {testResult.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span className="font-mono">{testResult.msg}</span>
        </div>
      )}

      {loaded?.source === "live" && loaded.liveJobUids && loaded.liveJobUids.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
            <span>{loaded.liveJobUids.length} jobs discovered</span>
            <span>pick one in the Configure step →</span>
          </div>
          <ScrollArea className="h-20 rounded border border-slate-200 bg-white p-1.5">
            <div className="flex flex-wrap gap-1">
              {loaded.liveJobUids.map((uid) => (
                <Badge key={uid} variant="outline" className="font-mono text-[10px]">{uid}</Badge>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-2.5 text-[11.5px] text-blue-800">
        <div className="flex items-start gap-2">
          <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-medium">How it works:</span> Your browser cannot call CryoSmart directly (CORS + HttpOnly cookies).
            Our Next.js API route <code className="mx-1 rounded bg-blue-100 px-1 font-mono text-[10px]">/api/cryosmart/[...path]</code> acts as a server-side proxy, forwarding each request with your cookie attached. Your cookie is stored only in localStorage (never sent to us).
          </div>
        </div>
      </div>
    </div>
  );
}

function SamplePanel({ onLoad }: Props) {
  const [startJob, setStartJob] = useState(10);
  const loadSample = useCallback(() => {
    const sample = buildSampleExportedMetadata({ startJob });
    onLoad({
      raw: sample,
      projectUid: sample.project_uid,
      jobCount: sample.jobs.length,
      source: "sample",
    });
    toast.success(`Loaded sample project (${sample.jobs.length} jobs, starting at J${startJob})`);
  }, [startJob, onLoad]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
            <FlaskConical className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h4 className="text-[13px] font-semibold text-slate-800">Synthetic cryo-EM workflow</h4>
            <p className="mt-0.5 text-[12px] text-slate-600">
              A realistic 10-job single-particle pipeline: import movies → motion correction → CTF →
              blob picker → extract → 2D classification → select 2D → ab initio → homo refine →
              (optional) heterogeneous refine. Use this to explore the report and download formats
              without needing a real CryoSmart instance.
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sample-start" className="text-[12px] text-slate-600">Start from Job</Label>
          <select
            id="sample-start"
            value={startJob}
            onChange={(e) => setStartJob(Number(e.target.value))}
            className="h-9 rounded-md border border-slate-300 bg-white px-2.5 text-[13px] font-mono"
          >
            <option value={10}>J10 — homo_refine_new (final)</option>
            <option value={11}>J11 — hetero_refine (4 classes)</option>
          </select>
        </div>
        <Button size="sm" onClick={loadSample} className="h-9 bg-teal-600 hover:bg-teal-700">
          <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
          Load sample project
        </Button>
      </div>
    </div>
  );
}
