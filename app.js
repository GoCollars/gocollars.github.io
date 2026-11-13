'use strict';

const $ = id => document.getElementById(id);
const labels = {'Galloping':'疾跑','Lying chest':'俯卧','Sitting':'坐姿','Sniffing':'嗅闻','Standing':'站立','Trotting':'小跑','Walking':'行走'};
const colors = ['#5794f4','#eaa36c','#63bba1'];
const signalColors = ['#447ed1','#ce8a48','#42957a'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {data:null, capture:null, selected:0, captureProgress:1, capturePlaying:false, captureStarted:0, behaviorProgress:199, behaviorPlaying:false, behaviorStarted:0, hover:null};
let toastTimer;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {$('toast').hidden = true;}, 4500);
}

function setupCanvas(canvas) {
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(box.width * ratio), h = Math.round(box.height * ratio);
  if (canvas.width !== w || canvas.height !== h) {canvas.width = w; canvas.height = h;}
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  ctx.clearRect(0,0,box.width,box.height);
  return {ctx,width:box.width,height:box.height};
}

function download(content, filename) {
  const url = URL.createObjectURL(new Blob([content], {type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function captureRows() {return serial.port ? serial.samples : state.capture?.samples || [];}
function captureDuration() {const rows = captureRows(); return rows.length > 1 ? Math.max(0,(rows.at(-1)[0]-rows[0][0])/1000) : 0;}

function drawCapture(canvas, offset) {
  const surface = setupCanvas(canvas);
  if (!surface || !state.capture) return;
  const {ctx,width,height} = surface;
  const rows = captureRows();
  const l=35, r=width-9, t=13, b=height-23;
  const duration = Math.max(captureDuration(), 1);
  // The replay axis remains fixed, while the USB view shows the latest 15 seconds.
  const end = duration, start = serial.port ? Math.max(0,end-15) : 0;
  const origin = rows[0]?.[0] || 0;
  const visibleRows = serial.port ? rows.filter(row => (row[0]-origin)/1000 >= start) : rows;
  let lo = Infinity, hi = -Infinity;
  visibleRows.forEach(row => row.slice(offset,offset+3).forEach(v => {lo=Math.min(lo,v);hi=Math.max(hi,v);}));
  if (!Number.isFinite(lo)) {lo=-1;hi=1;}
  const pad = Math.max((hi-lo)*.2, offset===1 ? .08 : .3); lo-=pad; hi+=pad;
  const x = value => l+(value-start)/(end-start)*(r-l);
  const y = value => b-(value-lo)/(hi-lo)*(b-t);
  ctx.font='9px -apple-system, sans-serif'; ctx.lineWidth=1;
  for (let i=0;i<=3;i++) {
    const yy=t+(b-t)*i/3;
    ctx.strokeStyle='#edf0f4'; ctx.beginPath();ctx.moveTo(l,yy);ctx.lineTo(r,yy);ctx.stroke();
    ctx.fillStyle='#9ea7b3';ctx.textAlign='right';ctx.fillText((hi-(hi-lo)*i/3).toFixed(1),l-7,yy+3);
  }
  for (let i=0;i<=4;i++) {
    const xx=l+(r-l)*i/4;
    ctx.strokeStyle='#f3f5f8';ctx.beginPath();ctx.moveTo(xx,t);ctx.lineTo(xx,b);ctx.stroke();
    ctx.fillStyle='#a7afba';ctx.textAlign='center';ctx.fillText(((start+(end-start)*i/4)).toFixed(1)+'s',xx,height-7);
  }
  const progress = serial.port ? 1 : state.captureProgress;
  const limit = progress*duration;
  const current = visibleRows.filter(row => (row[0]-origin)/1000<=limit);
  ctx.save();ctx.beginPath();ctx.rect(l,t,r-l,b-t);ctx.clip();
  colors.forEach((color,axis) => {
    ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.lineJoin='round';ctx.beginPath();
    current.forEach((row,i)=>{const xx=x((row[0]-origin)/1000),yy=y(row[offset+axis]); i ? ctx.lineTo(xx,yy) : ctx.moveTo(xx,yy);});ctx.stroke();
    const last=current.at(-1);
    if(last){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x((last[0]-origin)/1000),y(last[offset+axis]),2.2,0,Math.PI*2);ctx.fill();}
  });
  if(progress<1){ctx.strokeStyle='#b4c8ec';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x(limit),t);ctx.lineTo(x(limit),b);ctx.stroke();}
  ctx.restore();
  if (!rows.length) {ctx.fillStyle='#9aa8ba';ctx.textAlign='center';ctx.fillText('等待开发板数据…',(l+r)/2,(t+b)/2);}
}

function renderCapture() {
  if(!state.capture) return;
  const rows=captureRows(), duration=captureDuration();
  $('capture-count').innerHTML=rows.length.toLocaleString()+'<span> 组</span>';
  $('capture-duration').innerHTML=duration.toFixed(2)+'<span> s</span>';
  $('capture-rate').innerHTML=(duration>0?(rows.length-1)/duration:0).toFixed(1)+'<span> Hz</span>';
  $('capture-time').textContent=(serial.port?duration:duration*state.captureProgress).toFixed(2)+' / '+duration.toFixed(2)+' s';
  $('capture-seek').value=Math.round(state.captureProgress*1000);
  $('capture-play').textContent=(serial.port?serial.recording:state.capturePlaying)?'Ⅱ':'▶';
  $('capture-play').setAttribute('aria-label',serial.port?(serial.recording?'暂停采集':'继续采集'):(state.capturePlaying?'暂停采集回放':'播放采集记录'));
  $('capture-download').disabled=rows.length===0;
  drawCapture($('capture-acc'),1);drawCapture($('capture-gyro'),4);
}

function currentSamples() {return state.data?.sets.curated.samples || [];}
function currentSample() {return currentSamples()[state.selected];}

function setBehaviorPlaying(playing, completed=false) {
  state.behaviorPlaying=playing;
  if(playing){if(state.behaviorProgress>=199)state.behaviorProgress=0;state.behaviorStarted=performance.now()-state.behaviorProgress/100*1000;}
  $('behavior-play').textContent=playing?'Ⅱ':'▶';
  $('behavior-play').setAttribute('aria-label',playing?'暂停行为信号':'播放当前行为信号');
  $('ai-pipeline').classList.toggle('processing',playing);
  $('ai-pipeline').classList.toggle('inference-complete',completed);
  $('prediction-label').closest('.prediction-panel').setAttribute('aria-busy',String(playing));
  $('run-inference').innerHTML=playing?'正在读取信号 <span aria-hidden="true">· · ·</span>':'播放识别过程 <span aria-hidden="true">→</span>';
  $('inference-status-text').textContent=playing?'读取六轴信号…':completed?'行为概率已生成':'准备就绪';
}

function renderSamples() {
  const list=$('sample-list');list.replaceChildren();
  currentSamples().forEach((s,i) => {
    const button=document.createElement('button');button.className='sample-button';button.type='button';button.setAttribute('aria-pressed',String(i===state.selected));
    button.setAttribute('aria-label',`样本 ${i+1}，${labels[s.label]}，模型${s.label===s.prediction?'预测正确':'预测有差异'}`);
    button.innerHTML=`<span class="sample-number">${String(i+1).padStart(2,'0')}</span><span><strong>${labels[s.label]}</strong><small>${s.label}</small></span><span class="sample-status ${s.prediction===s.label?'':'error'}" aria-hidden="true"></span>`;
    button.addEventListener('click',()=>{selectSample(i);state.behaviorProgress=0;setBehaviorPlaying(true);});list.append(button);
  });
}

function selectSample(index, scroll=false) {
  state.selected=index;state.behaviorProgress=199;state.hover=null;setBehaviorPlaying(false);
  $('signal-tooltip').hidden=true;
  const s=currentSample();if(!s)return;
  renderSamples();
  if(scroll)$('sample-list').children[index].scrollIntoView({block:'nearest',inline:'nearest',behavior:reducedMotion?'instant':'smooth'});
  $('signal-title').textContent=`样本 ${String(index+1).padStart(2,'0')}`;
  $('truth-label').textContent=labels[s.label];
  $('prediction-label').textContent=labels[s.prediction];$('prediction-en').textContent=s.prediction;
  const match=s.prediction===s.label;
  $('prediction-match').textContent=match?'✓ 与真实标签一致':'↔ 与真实标签有差异';
  $('prediction-match').className='match-badge'+(match?'':' mismatch');
  const classes=state.data.classes;
  const container=$('probabilities');
  if(container.children.length!==classes.length){
    container.replaceChildren(...classes.map(()=>{
      const row=document.createElement('div');
      row.innerHTML='<div><span></span><b></b></div><div class="probability-track"><i></i></div>';
      return row;
    }));
  }
  classes.forEach((label,index)=>{
    const value=s.probabilities[label],row=container.children[index];
    row.dataset.label=label;
    row.className='probability-row'+(label===s.prediction?' top-probability':'');
    const pct=value*100;const number=pct>0&&pct<.01?'<0.01':pct.toFixed(2);
    row.querySelector('span').textContent=labels[label];
    row.querySelector('b').textContent=number+'%';
    row.querySelector('i').style.width=pct+'%';
    row.title=`${label}: ${pct.toPrecision(6)}%`;
  });
  $('sample-download').href=s.csv;
  $('behavior-seek').value=199;
  $('signal-position').textContent='0.00 — 2.00 s';
  drawBehavior();
}

function drawBehavior() {
  const s=currentSample(),surface=setupCanvas($('behavior-signal'));
  if(!s||!surface)return;
  const {ctx,width,height}=surface;
  const gapY=12,left=29,right=8,top=5,bottom=21;
  const rowH=(height-top-bottom-gapY*5)/6;
  const end=Math.floor(state.behaviorProgress);
  const axes=['AX','AY','AZ','GX','GY','GZ'];
  for(let channel=0;channel<6;channel++){
    const row=channel%3,x0=left,y0=top+channel*(rowH+gapY),x1=width-right,y1=y0+rowH;
    const values=s.signal.map(v=>v[channel]);let lo=Math.min(...values),hi=Math.max(...values);
    const pad=Math.max((hi-lo)*.14,.001);lo-=pad;hi+=pad;
    const xx=i=>x0+i/199*(x1-x0),yy=v=>y1-(v-lo)/(hi-lo)*rowH;
    ctx.font='9px ui-monospace, monospace';ctx.textAlign='left';ctx.fillStyle=signalColors[row];ctx.fillText(axes[channel],0,y0+rowH/2+3);
    ctx.strokeStyle='#e2e8f1';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x0,y0+rowH/2);ctx.lineTo(x1,y0+rowH/2);ctx.stroke();
    for(let tick=0;tick<=2;tick++){
      const x=x0+(x1-x0)*tick/2;ctx.strokeStyle='#edf1f6';ctx.beginPath();ctx.moveTo(x,y0);ctx.lineTo(x,y1);ctx.stroke();
      if(channel===5){ctx.textAlign='center';ctx.fillStyle='#8b99ad';ctx.fillText((tick).toFixed(1)+'s',x,y1+15);}
    }
    ctx.save();ctx.beginPath();ctx.rect(x0,y0,x1-x0,rowH);ctx.clip();
    ctx.strokeStyle=signalColors[row];ctx.lineWidth=1.25;ctx.lineJoin='round';ctx.beginPath();
    values.slice(0,end+1).forEach((v,i)=>i?ctx.lineTo(xx(i),yy(v)):ctx.moveTo(xx(i),yy(v)));ctx.stroke();
    const cursor=state.hover!==null?state.hover:(end<199?end:null);
    if(cursor!==null){ctx.setLineDash([2,3]);ctx.strokeStyle='#839fc288';ctx.beginPath();ctx.moveTo(xx(cursor),y0);ctx.lineTo(xx(cursor),y1);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=signalColors[row];ctx.beginPath();ctx.arc(xx(cursor),yy(values[cursor]),2.2,0,Math.PI*2);ctx.fill();}
    ctx.restore();
  }
}

function heroFrame(time) {
  const surface=setupCanvas($('hero-particles'));if(!surface)return;
  const {ctx,width,height}=surface;
  const palette=['#4285f4','#e5ab41','#56a47c','#e78c6e'];
  const moving=reducedMotion?0:time*.0001;
  for(let i=0;i<22;i++){
    const angle=i*2.39996+moving*(i%2?1:-1);
    const rad=.35+(i%5)*.017;
    const x=width/2+Math.cos(angle)*width*rad,y=height/2+Math.sin(angle)*height*rad;
    const size=i%5===0?3.7:1.8;
    ctx.fillStyle=palette[i%4];ctx.globalAlpha=i%3===0?.65:.26;ctx.beginPath();ctx.arc(x,y,size,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
}

let lastPaint=0;
const heroVisible={value:true};
new IntersectionObserver(entries=>{heroVisible.value=entries[0].isIntersecting;}).observe($('hero-visual'));
function frame(time) {
  if(!document.hidden&&time-lastPaint>32){
    if(heroVisible.value)heroFrame(time);
    if(state.capturePlaying&&!serial.port&&state.capture){state.captureProgress=Math.min(1,(time-state.captureStarted)/(captureDuration()*1000));if(state.captureProgress>=1)state.capturePlaying=false;renderCapture();}
    if(state.behaviorPlaying){state.behaviorProgress=Math.min(199,(time-state.behaviorStarted)/1000*100);$('behavior-seek').value=Math.floor(state.behaviorProgress);$('signal-position').textContent=(state.behaviorProgress/100).toFixed(2)+' / 2.00 s';$('inference-status-text').textContent=state.behaviorProgress<70?'读取六轴信号…':state.behaviorProgress<145?'提取运动模式…':'生成行为分布…';if(state.behaviorProgress>=199)setBehaviorPlaying(false,true);drawBehavior();}
    lastPaint=time;
  }
  requestAnimationFrame(frame);
}

// Web Serial is optional; every demonstration also works without a device.
// The protocol matches the shipped XIAO firmware: ? -> PONG, r -> IMU,...
const serial={port:null,reader:null,writer:null,readTask:null,samples:[],recording:false,ready:false,closing:false,pollTimer:null,handshakeTimer:null,pending:false,pendingSince:0,epoch:0};

function showCaptureError(message){$('capture-error').textContent=message;$('capture-error').hidden=!message;}
async function writeSerial(command){if(!serial.writer)throw new Error('串口未连接');await serial.writer.write(new TextEncoder().encode(command));}

function serialLine(line) {
  if(line==='PONG,GO_COLLARS_XIAO_IMU_V1'){serial.ready=true;return;}
  if(line.startsWith('ERR,')){showCaptureError('开发板报告 IMU 初始化失败。请检查板型与固件。');serial.recording=false;renderCapture();return;}
  if(!line.startsWith('IMU,'))return;
  serial.pending=false;
  const row=line.split(',').slice(1).map(Number);
  if(row.length!==7||!row.every(Number.isFinite)||!serial.recording)return;
  if(serial.samples.length&&row[0]<serial.samples.at(-1)[0]){serial.recording=false;showCaptureError('检测到开发板时间戳重置，采集已暂停。请先导出记录，再重新连接。');renderCapture();return;}
  serial.samples.push(row);
  if(serial.samples.length>=100000){serial.recording=false;toast('已达到本次 100,000 组上限，请导出 CSV。');}
  renderCapture();
}

async function readSerial() {
  let buffer='';const decoder=new TextDecoder();
  try{
    while(serial.reader){const {value,done}=await serial.reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);serialLine(line);}if(buffer.length>4096)throw new Error('串口数据格式不符合固件协议');}
  }catch(error){if(!serial.closing){serial.recording=false;serial.ready=false;showCaptureError('串口读取中断，请导出已有数据并断开设备。'+error.message);renderCapture();}}
  finally{if(serial.reader){serial.reader.releaseLock();serial.reader=null;}}
}

function pollSerial() {
  serial.pollTimer=setInterval(async()=>{
    if(!serial.ready||!serial.recording||serial.closing)return;
    if(serial.pending){if(performance.now()-serial.pendingSince>2000){serial.recording=false;showCaptureError('设备超过 2 秒未返回数据，已暂停。可导出已有记录后重新连接。');renderCapture();}return;}
    serial.pending=true;serial.pendingSince=performance.now();
    try{await writeSerial('r');}catch(error){serial.pending=false;serial.recording=false;showCaptureError('发送采样指令失败：'+error.message);renderCapture();}
  },55);
}

async function connectSerial() {
  if(!('serial' in navigator)){toast('当前浏览器不支持 Web Serial，请用桌面 Chrome 或 Edge 打开。');return;}
  const button=$('usb-confirm');button.disabled=true;
  try{
    const port=await navigator.serial.requestPort();
    await port.open({baudRate:115200});serial.port=port;serial.epoch++;serial.closing=false;serial.ready=false;serial.pending=false;serial.samples=[];
    serial.writer=port.writable.getWriter();serial.reader=port.readable.getReader();serial.readTask=readSerial();
    // Give USB CDC time to settle and retry the handshake, without requesting samples.
    const deadline=performance.now()+3500;
    while(!serial.ready&&performance.now()<deadline){await writeSerial('?');await new Promise(resolve=>setTimeout(resolve,300));}
    if(!serial.ready)throw new Error('没有收到 GoCollars 固件握手，请检查固件和串口。');
    state.capturePlaying=false;state.captureProgress=1;serial.recording=true;
    $('capture-mode').textContent='USB 实时采集';
    $('usb-connect').textContent='断开设备 ↗';$('capture-reset').textContent='查看说明';$('capture-seek').disabled=true;
    showCaptureError('');$('usb-dialog').close();renderCapture();pollSerial();toast('IMU PCB 已连接，正在读取六轴数据。');
  }catch(error){if(serial.port)await closeSerial();if(error.name!=='NotFoundError'){showCaptureError(error.message);$('usb-support-note').textContent=error.message;}}
  finally{button.disabled=false;}
}

async function closeSerial() {
  serial.closing=true;serial.recording=false;serial.ready=false;serial.pending=false;
  clearInterval(serial.pollTimer);
  try{if(serial.reader)await serial.reader.cancel();if(serial.readTask)await serial.readTask;if(serial.writer){serial.writer.releaseLock();serial.writer=null;}if(serial.port)await serial.port.close();}catch(error){showCaptureError('串口已停止。'+error.message);}
  serial.port=null;serial.closing=false;
}

async function disconnectSerial() {
  if(serial.samples.length){download('board_ms,ax_g,ay_g,az_g,gx_deg_s,gy_deg_s,gz_deg_s\n'+serial.samples.map(row=>row.join(',')).join('\n'),'gocollars_usb_capture.csv');toast('已导出本次采集，并切回示例回放。');}
  await closeSerial();state.captureProgress=1;state.capturePlaying=false;
  $('capture-mode').textContent='真实采集回放';
  $('usb-connect').innerHTML='连接 IMU PCB <span aria-hidden="true">↗</span>';$('capture-reset').textContent='重置 ↺';$('capture-seek').disabled=false;renderCapture();
}

function bindEvents() {
  $('next-sample').addEventListener('click',()=>{if(state.data){selectSample((state.selected+1)%currentSamples().length,true);state.behaviorProgress=0;setBehaviorPlaying(true);}});
  $('capture-play').addEventListener('click',()=>{
    if(!state.capture)return;
    if(serial.port){if(!serial.ready){toast('设备已中断，请先导出数据并重新连接。');return;}serial.recording=!serial.recording;serial.pending=false;renderCapture();return;}
    state.capturePlaying=!state.capturePlaying;if(state.capturePlaying){if(state.captureProgress>=1)state.captureProgress=0;state.captureStarted=performance.now()-state.captureProgress*captureDuration()*1000;}renderCapture();
  });
  $('capture-seek').addEventListener('input',event=>{state.capturePlaying=false;state.captureProgress=Number(event.target.value)/1000;renderCapture();});
  $('capture-reset').addEventListener('click',()=>{if(serial.port){toast('暂停后可继续采集；断开设备时会自动导出 CSV。');return;}state.capturePlaying=false;state.captureProgress=0;renderCapture();});
  $('capture-download').addEventListener('click',()=>{if(!state.capture)return;const rows=captureRows();download(state.capture.columns.join(',')+'\n'+rows.map(r=>r.join(',')).join('\n'),serial.port?'gocollars_usb_capture.csv':'gocollars_usb_demo.csv');toast('CSV 已导出。');});
  $('behavior-play').addEventListener('click',()=>{if(state.data)setBehaviorPlaying(!state.behaviorPlaying);});
  $('run-inference').addEventListener('click',()=>{if(state.data){state.behaviorProgress=0;setBehaviorPlaying(true);}});
  $('behavior-seek').addEventListener('input',event=>{setBehaviorPlaying(false);state.behaviorProgress=Number(event.target.value);$('signal-position').textContent=(state.behaviorProgress/100).toFixed(2)+' / 2.00 s';drawBehavior();});
  $('view-image').addEventListener('click',()=>{const s=currentSample();if(!s)return;$('original-image').src=s.image;$('image-dialog-title').textContent=`样本 ${String(s.number).padStart(2,'0')} · ${labels[s.label]} · 原始波形图`;$('image-dialog').showModal();});
  document.querySelectorAll('.dialog-close').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
  $('usb-connect').addEventListener('click',()=>{
    if(serial.port){disconnectSerial();return;}
    const supported='serial' in navigator&&window.isSecureContext;
    $('usb-support-note').textContent=supported?'支持 Web Serial。请选择已烧录兼容固件的串口设备。':'当前浏览器无法直接访问串口。请用桌面 Chrome / Edge，在 localhost 或 HTTPS 打开本页。';
    $('usb-confirm').disabled=!supported;$('usb-dialog').showModal();
  });
  $('usb-confirm').addEventListener('click',connectSerial);
  if('serial' in navigator)navigator.serial.addEventListener('disconnect',()=>{if(serial.port){serial.recording=false;serial.ready=false;showCaptureError('USB 设备已断开。已有记录保留在本页，可先导出 CSV，再点击断开设备。');renderCapture();}});
  $('behavior-signal').addEventListener('pointermove',event=>{
    const s=currentSample();if(!s||event.pointerType==='touch')return;
    const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    const index=Math.max(0,Math.min(199,Math.round((x-29)/(rect.width-29-8)*199)));state.hover=index;
    const tip=$('signal-tooltip');tip.hidden=false;tip.textContent=`${(index/100).toFixed(2)} s\nAX ${s.signal[index][0].toFixed(3)}  GX ${s.signal[index][3].toFixed(2)}\nAY ${s.signal[index][1].toFixed(3)}  GY ${s.signal[index][4].toFixed(2)}\nAZ ${s.signal[index][2].toFixed(3)}  GZ ${s.signal[index][5].toFixed(2)}`;
    tip.style.left=Math.max(0,Math.min(rect.width-190,x+12))+'px';tip.style.top=Math.max(0,Math.min(rect.height-90,y-75))+'px';drawBehavior();
  });
  $('behavior-signal').addEventListener('pointerleave',()=>{state.hover=null;$('signal-tooltip').hidden=true;drawBehavior();});
  let resizeQueued=false;new ResizeObserver(()=>{if(!resizeQueued){resizeQueued=true;requestAnimationFrame(()=>{renderCapture();drawBehavior();heroFrame(performance.now());resizeQueued=false;});}}).observe(document.body);
  window.addEventListener('beforeunload',event=>{if(serial.samples.length&&serial.port){event.preventDefault();event.returnValue='';}});
}

async function loadData(path){const response=await fetch(path);if(!response.ok)throw new Error('无法载入 '+path);return response.json();}
async function init(){
  bindEvents();requestAnimationFrame(frame);
  const results=await Promise.allSettled([loadData('assets/data/capture.json'),loadData('assets/data/samples.json'),loadData('assets/data/evaluation.json')]);
  if(results[0].status==='fulfilled'){state.capture=results[0].value;renderCapture();}else{showCaptureError('采集数据载入失败。请通过本地 HTTP 服务打开页面并刷新。');}
  if(results[1].status==='fulfilled'){state.data=results[1].value;selectSample(0);}else{$('signal-title').textContent='样本载入失败';toast('样本数据载入失败，请检查本地服务。');}
  if(results[2].status==='fulfilled'){
    $('our-f1').textContent=(results[2].value.model.macro_f1*100).toFixed(2);
    const comparison=results[2].value.presentation.comparison;
    $('comparison-f1').textContent=Number.isFinite(comparison.macro_f1)?(comparison.macro_f1*100).toFixed(2):'—';
  }
}
init();
