"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check } from 'lucide-react';
import { SmartCapturePanel } from './smart-capture-panel';
import type { CryoSmartSession } from '@/lib/cryosmart/proxy-client';

export interface LoadedMetadata {
  raw: unknown;
  projectUid: string;
  jobCount: number;
  source: 'upload' | 'sample' | 'live' | 'bookmarklet';
  session?: CryoSmartSession | null;
  liveJobUids?: string[];
  cryosmartOrigin?: string;
}

interface Props {
  loaded: LoadedMetadata | null;
  onLoad: (loaded: LoadedMetadata) => void;
}

export function DataSourceCard({ loaded, onLoad }: Props) {
  return (
    <Card id="data-source" className="scroll-mt-28 overflow-hidden">
      <CardHeader className="bg-gradient-to-br from-slate-50 to-teal-50/40 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-600 text-[13px] font-bold text-white">1</span>
              <CardTitle className="text-lg">Smart Capture</CardTitle>
            </div>
            <CardDescription className="mt-1.5 pl-9 text-[13px]">
              Extract complete job metadata from CryoSmart SPA, including input_slot_groups and params_spec.
              Session info is captured for map/image downloads.
            </CardDescription>
          </div>
          {loaded && (
            <Badge variant="secondary" className="gap-1.5 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
              <Check className="h-3.5 w-3.5" />
              {loaded.jobCount} jobs loaded
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-4">
        <SmartCapturePanel
          onCapture={(data) => {
            onLoad({
              raw: { jobs: data.jobs },
              projectUid: data.projectUid,
              jobCount: data.jobs.length,
              source: 'bookmarklet',
              cryosmartOrigin: 'http://192.168.202.11:8080',
            });
          }}
        />

        {loaded && (

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-[12px]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="text-slate-500">Loaded:</span>
              <span className="font-mono text-slate-700">project = {loaded.projectUid}</span>
              <span className="font-mono text-slate-700">jobs = {loaded.jobCount}</span>
              <span className="font-mono text-slate-700">source = {loaded.source}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
