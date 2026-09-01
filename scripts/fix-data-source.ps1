 # Fix data-source-card.tsx
 $file = "D:\AI-web-app\cryosmart-lineage-tracer-web\src\app\components\cryosmart\data-source-card.tsx"
 $content = Get-Content $file -Raw -Encoding UTF8
 
 # Add SmartCapturePanel import
 if ($content -notmatch 'import \{ SmartCapturePanel \} from "./smart-capture-panel"') {
     $content = $content -replace 'import \{ BookmarkletPanel \} from "./bookmarklet-panel";', 'import { BookmarkletPanel } from "./bookmarklet-panel";
import { SmartCapturePanel } from "./smart-capture-panel";'
 }
 
 # Add Zap to lucide imports
 if ($content -notmatch '^\s+Zap,$') {
     $content = $content -replace '(ChevronRight,)', "`$1`n  Zap,"
 }
 
 # Add TabsTrigger for smart
 if ($content -notmatch '<TabsTrigger value="smart"') {
     $content = $content -replace '(<TabsTrigger value="sample"[^>]*>[^<]*</TabsTrigger>)', "`$1`n            <TabsTrigger value=`"smart`" className=`"text-[12.5px] data-[state=active]:bg-white`">`n              <Zap className=`"mr-1 h-3.5 w-3.5`" /> Smart Capture`n            </TabsTrigger>"
 }
 
 # Add TabsContent for smart
 if ($content -notmatch '<TabsContent value="smart"') {
     $smartContent = @'
           <TabsContent value="smart" className="mt-4">
             <SmartCapturePanel 
               onCapture={(data) => {
                 onLoad({
                   raw: { jobs: data.jobs },
                   projectUid: data.projectUid,
                   jobCount: data.jobs.length,
                   source: "bookmarklet",
                   cryosmartOrigin: "http://192.168.202.11:8080",
                 });
               }}
               webAppUrl={typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3002'}
             />
           </TabsContent>
'@
     $content = $content -replace '(<TabsContent value="bookmarklet" className="mt-4">[\s\S]*?</TabsContent>)', "`$1`n$smartContent"
 }
 
 Set-Content -Path $file -Value $content -Encoding UTF8
 Write-Host "Done"
