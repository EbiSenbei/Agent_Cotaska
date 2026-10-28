import React from 'react';
import { createRoot } from 'react-dom/client';
import AiChatContextPanel from '../../src/renderer/components/AiChatContextPanel';
import { clampContextPanelWidth, loadContextPanelWidth } from '../../src/renderer/components/aiChatUiUtils';
import '../../src/renderer/styles/app-components.css';
import '../../src/renderer/styles/ai-chat.css';

window.cotaskaAPI = { tasks: { getContent: async () => '' } };
document.body.style.margin = '0';
const task = { id: 'T-0848', title: '幅と閉じる操作の確認用の長いタスク名'.repeat(12), status: 'todo', tags: [], content: '' };
const delay = () => new Promise(resolve => setTimeout(resolve, 80));
const assert = (ok, label) => { if (!ok) throw Error(label); };
let closed = 0;
const root = createRoot(document.getElementById('root'));
function render(width, type='task') {
  root.render(<div className="ai-chat-screen ai-chat-screen--with-context" style={{ '--ai-context-panel-width': `${width}px`, position: 'relative' }}>
    <div/><div/>
    <AiChatContextPanel contextPanel={{ type, title: task.title, subtitle: task.id, task, file: { preview_type: 'text', content: 'preview' } }}
      tasks={[task]} lists={[]} tags={[]} isMarkdownFile={() => false} onClose={() => closed++}/>
  </div>);
}
async function run() {
  localStorage.removeItem('cotaska.aiChat.contextPanelWidth');
  assert(loadContextPanelWidth()===520, 'unsaved default');
  localStorage.setItem('cotaska.aiChat.contextPanelWidth','320');
  assert(loadContextPanelWidth()===480, 'legacy width');
  const results=[];
  for (const viewport of [1440,1266,1024,600]) {
    window.testViewport={width:viewport};
    while(!window.testViewport.done) await delay();
    for (const width of [loadContextPanelWidth(),520,clampContextPanelWidth(100),720]) {
      render(width); await delay();
      const panel=document.querySelector('.ai-right-pane').getBoundingClientRect();
      assert(panel.left>=0 && panel.right<=innerWidth, 'panel inside viewport');
      for(const button of document.querySelectorAll('.ai-right-pane button[title="閉じる"]')) {
        const r=button.getBoundingClientRect();
        assert(r.width>0 && r.left>=panel.left && r.right<=panel.right && r.top>=panel.top, 'close visible');
        assert(button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)), 'close reachable');
        const previous=closed;button.click();assert(closed===previous+1,'close handler');
      }
      results.push({viewport,width,actualWidth:panel.width});
    }
  }
  render(520,'file'); await delay();
  assert(document.querySelector('.ai-file-preview-editor').value==='preview','file preview');
  window.parallelResult={ok:true,checks:results};
}
run().catch(error=>{window.parallelResult={ok:false,error:error.stack};});
