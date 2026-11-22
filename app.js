'use strict';

const $ = id => document.getElementById(id);
const labels = {'Rest':'静息','Locomotion':'移动','Feed':'进食','Galloping':'疾跑','Lying chest':'俯卧','Sitting':'坐姿','Sniffing':'嗅闻','Standing':'站立','Trotting':'小跑','Walking':'行走'};
const colors = ['#5794f4','#eaa36c','#63bba1'];
const signalColors = ['#447ed1','#ce8a48','#42957a'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {data:null, capture:null, selected:0, species:'dog', captureProgress:1, capturePlaying:false, captureStarted:0, behaviorProgress:199, behaviorPlaying:false, behaviorStarted:0, hover:null};
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

function captureRows() {return device.hasSession ? device.samples : state.capture?.samples || [];}
function captureDuration() {const rows = captureRows(); return rows.length > 1 ? Math.max(0,(rows.at(-1)[0]-rows[0][0])/1000) : 0;}

function drawCapture(canvas, offset) {
  const surface = setupCanvas(canvas);
  if (!surface || !state.capture) return;
  const {ctx,width,height} = surface;
  const rows = captureRows();
  const l=35, r=width-9, t=13, b=height-23;
  const duration = Math.max(captureDuration(), 1);
  // The replay axis remains fixed, while the USB view shows the latest 15 seconds.
  const end = duration, start = device.hasSession ? Math.max(0,end-15) : 0;
  const origin = rows[0]?.[0] || 0;
  const visibleRows = device.hasSession ? rows.filter(row => (row[0]-origin)/1000 >= start) : rows;
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
  const progress = device.hasSession ? 1 : state.captureProgress;
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
  updateDeviceButtons();
  if(!state.capture) return;
  const rows=captureRows(), duration=captureDuration();
  $('capture-count').innerHTML=rows.length.toLocaleString()+'<span> 组</span>';
  $('capture-duration').innerHTML=duration.toFixed(2)+'<span> s</span>';
  $('capture-rate').innerHTML=(duration>0?(rows.length-1)/duration:0).toFixed(1)+'<span> Hz</span>';
  $('capture-time').textContent=(device.hasSession?duration:duration*state.captureProgress).toFixed(2)+' / '+duration.toFixed(2)+' s';
  $('capture-seek').value=Math.round(state.captureProgress*1000);
  $('capture-play').textContent=(device.hasSession?device.recording:state.capturePlaying)?'Ⅱ':'▶';
  $('capture-play').setAttribute('aria-label',device.hasSession?(device.recording?'暂停采集':'继续采集'):(state.capturePlaying?'暂停采集回放':'播放采集记录'));
  $('capture-download').disabled=rows.length===0;
  $('capture-seek').disabled=device.hasSession;
  $('capture-play').disabled=device.hasSession;
  $('capture-reset').textContent=device.hasSession?'返回示例 ↺':'重置 ↺';
  $('capture-mode').textContent=device.hasSession?`${device.sessionKind==='ble'?'BLE':'USB'}记录${device.status?' · '+device.status:''}`:device.ready?`${device.kind==='ble'?'BLE':'USB'}已连接 · 示例回放`:'真实采集回放';
  $('capture-loss').innerHTML=device.hasSession?`${device.parser.dropped}<span> 点</span>`:'—';
  $('capture-detail').textContent=device.hasSession?`目标 ${device.hz} Hz · ${device.count?`${device.count}点批次`:'连续采集'} · 板端漏采 / 溢出 ${device.parser.missed} · 数据保留在本页，请及时导出。`:'连接开发板后点击「开始记录」。';
  showCaptureError(device.error);
  drawCapture($('capture-acc'),1);drawCapture($('capture-gyro'),4);
}

function currentSet() {return state.data?.sets[state.species];}
function currentSamples() {return currentSet()?.samples || [];}
function currentSample() {return currentSamples()[state.selected];}
function sampleTiming() {
  const samples=currentSample().signal.length;
  const hz=currentSet().hz;
  return {last:samples-1,hz,seconds:samples/hz};
}
function updateBehaviorPosition() {
  const {last,hz,seconds}=sampleTiming();
  const finished=state.behaviorProgress>=last;
  $('behavior-seek').value=Math.floor(state.behaviorProgress);
  $('signal-position').textContent=finished?`0.00 — ${seconds.toFixed(2)} s`:
    `${(state.behaviorProgress/hz).toFixed(2)} / ${seconds.toFixed(2)} s`;
}

function setBehaviorPlaying(playing, completed=false) {
  state.behaviorPlaying=playing;
  if(playing){
    const {last,hz}=sampleTiming();
    if(state.behaviorProgress>=last)state.behaviorProgress=0;
    state.behaviorStarted=performance.now()-state.behaviorProgress/hz*1000;
  }
  $('behavior-play').textContent=playing?'Ⅱ':'▶';
  $('behavior-play').setAttribute('aria-label',playing?'暂停行为信号':'播放当前行为信号');
  $('ai-pipeline').classList.toggle('processing',playing);
  $('ai-pipeline').classList.toggle('inference-complete',completed);
  $('prediction-label').closest('.prediction-panel').setAttribute('aria-busy',String(playing));
  $('run-inference').innerHTML=playing?'正在读取信号 <span aria-hidden="true">· · ·</span>':'播放识别过程 <span aria-hidden="true">→</span>';
  $('inference-status-text').textContent=playing?'读取信号…':completed?'行为概率已生成':'准备就绪';
}

function renderSamples() {
  const list=$('sample-list');list.replaceChildren();
  const species=state.species==='dog'?'犬':'猫';
  $('sample-total').textContent=`${species} · ${currentSamples().length} 个样本`;
  currentSamples().forEach((s,i) => {
    const button=document.createElement('button');button.className='sample-button';button.type='button';
    button.setAttribute('aria-pressed',String(i===state.selected));
    button.setAttribute('aria-label',`${species}样本 ${i+1}，${labels[s.label]}`);
    button.innerHTML=`<span class="sample-number">${String(i+1).padStart(2,'0')}</span><span><strong>${labels[s.label]}</strong><small>${s.label}</small></span><span class="sample-status ${s.prediction===s.label?'':'error'}" aria-hidden="true"></span>`;
    button.addEventListener('click',()=>{selectSample(i);state.behaviorProgress=0;setBehaviorPlaying(true);});
    list.append(button);
  });
}

function selectSample(index, scroll=false) {
  state.selected=index;state.hover=null;setBehaviorPlaying(false);
  $('signal-tooltip').hidden=true;
  const s=currentSample();if(!s)return;
  const {last,hz}=sampleTiming();
  const channels=s.signal[0].length;
  state.behaviorProgress=last;
  renderSamples();
  if(scroll)$('sample-list').children[index].scrollIntoView({block:'nearest',inline:'nearest',behavior:reducedMotion?'instant':'smooth'});
  const species=state.species==='dog'?'犬只':'猫咪';
  $('signal-title').textContent=`${species}样本 ${String(index+1).padStart(2,'0')}`;
  $('signal-kind').textContent=`${hz} Hz · ${channels===3?'三轴加速度':'六轴 IMU'}`;
  $('signal-caption').textContent=`${channels} 轴 IMU 波形`;
  $('behavior-signal').setAttribute('aria-label',`${species}的 ${channels} 通道 IMU 信号`);
  $('model-spec').textContent=`${currentSet().classes.length} 类行为`;
  $('truth-label').textContent=labels[s.label];
  window.GoCollarsBehaviors.select(state.species,s.label);
  $('prediction-label').textContent=labels[s.prediction];$('prediction-en').textContent=s.prediction;
  const match=s.prediction===s.label;
  $('prediction-match').textContent=match?'✓ 与真实标签一致':'↔ 与真实标签有差异';
  $('prediction-match').className='match-badge'+(match?'':' mismatch');
  const classes=currentSet().classes;
  const container=$('probabilities');
  if(container.children.length!==classes.length){
    container.replaceChildren(...classes.map(()=>{
      const row=document.createElement('div');
      row.innerHTML='<div><span></span><b></b></div><div class="probability-track"><i></i></div>';
      return row;
    }));
  }
  classes.forEach((label,i)=>{
    const value=s.probabilities[label],row=container.children[i];
    row.dataset.label=label;
    row.className='probability-row'+(label===s.prediction?' top-probability':'');
    const pct=value*100;const number=pct>0&&pct<.01?'<0.01':pct.toFixed(2);
    row.querySelector('span').textContent=labels[label];
    row.querySelector('b').textContent=number+'%';
    row.querySelector('i').style.width=pct+'%';
    row.title=`${label}: ${pct.toPrecision(6)}%`;
  });
  $('model-comparison').replaceChildren(...[['GPT‑6.1 Sol',s.solPrediction],['Qwen4-Max',s.qwenPrediction]]
    .filter(([,prediction])=>prediction!==undefined).map(([name,prediction])=>{
      const row=document.createElement('p');
      const result=document.createElement('strong');
      result.textContent=labels[prediction] || '无有效标签';
      row.append(name+' ',result);
      return row;
    }));
  $('sample-download').href=s.csv;
  $('behavior-seek').max=last;
  updateBehaviorPosition();
  drawBehavior();
}

function drawBehavior() {
  const s=currentSample(),surface=setupCanvas($('behavior-signal'));
  if(!s||!surface)return;
  const {ctx,width,height}=surface;
  const {last,seconds}=sampleTiming();
  const channels=s.signal[0].length;
  const gapY=12,left=29,right=8,top=5,bottom=21;
  const rowH=(height-top-bottom-gapY*(channels-1))/channels;
  const end=Math.floor(state.behaviorProgress);
  const axes=['AX','AY','AZ','GX','GY','GZ'];
  for(let channel=0;channel<channels;channel++){
    const row=channel%3,x0=left,y0=top+channel*(rowH+gapY),x1=width-right,y1=y0+rowH;
    const values=s.signal.map(v=>v[channel]);let lo=Math.min(...values),hi=Math.max(...values);
    const pad=Math.max((hi-lo)*.14,.001);lo-=pad;hi+=pad;
    const xx=i=>x0+i/last*(x1-x0),yy=v=>y1-(v-lo)/(hi-lo)*rowH;
    ctx.font='9px ui-monospace, monospace';ctx.textAlign='left';ctx.fillStyle=signalColors[row];ctx.fillText(axes[channel],0,y0+rowH/2+3);
    ctx.strokeStyle='#e2e8f1';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(x0,y0+rowH/2);ctx.lineTo(x1,y0+rowH/2);ctx.stroke();
    for(let tick=0;tick<=2;tick++){
      const x=x0+(x1-x0)*tick/2;ctx.strokeStyle='#edf1f6';ctx.beginPath();ctx.moveTo(x,y0);ctx.lineTo(x,y1);ctx.stroke();
      if(channel===channels-1){
        ctx.textAlign=tick===0?'left':tick===2?'right':'center';
        ctx.fillStyle='#8b99ad';ctx.fillText((seconds*tick/2).toFixed(2)+' s',x,y1+15);
      }
    }
    ctx.save();ctx.beginPath();ctx.rect(x0,y0,x1-x0,rowH);ctx.clip();
    ctx.strokeStyle=signalColors[row];ctx.lineWidth=1.25;ctx.lineJoin='round';ctx.beginPath();
    values.slice(0,end+1).forEach((v,i)=>i?ctx.lineTo(xx(i),yy(v)):ctx.moveTo(xx(i),yy(v)));ctx.stroke();
    const cursor=state.hover!==null?state.hover:(end<last?end:null);
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
    if(state.capturePlaying&&!device.hasSession&&state.capture){state.captureProgress=Math.min(1,(time-state.captureStarted)/(captureDuration()*1000));if(state.captureProgress>=1)state.capturePlaying=false;renderCapture();}
    if(device.recording)renderCapture();
    if(state.behaviorPlaying){
      const {last,hz}=sampleTiming();
      state.behaviorProgress=Math.min(last,(time-state.behaviorStarted)/1000*hz);
      updateBehaviorPosition();
      const progress=state.behaviorProgress/last;
      $('inference-status-text').textContent=progress<.35?'读取信号…':progress<.73?'提取运动模式…':'生成行为分布…';
      if(state.behaviorProgress>=last)setBehaviorPlaying(false,true);
      drawBehavior();
    }
    lastPaint=time;
  }
  requestAnimationFrame(frame);
}

// Browser-local capture; USB and BLE share the same firmware stream parser.
const device=new GoCollarsDevice.Connection(()=>{state.capturePlaying=false;renderCapture();});
function showCaptureError(message){$('capture-error').textContent=message;$('capture-error').hidden=!message;}
function exportCapture(){
  if(device.hasSession){download(device.csv(),`gocollars_${device.sessionKind}_${device.hz}hz.csv`);device.dirty=false;}
  else download(state.capture.columns.join(',')+'\n'+state.capture.samples.map(row=>row.join(',')).join('\n'),'gocollars_usb_demo.csv');
  toast('CSV 已导出');
}
async function startCapture(){
  if(device.dirty&&!confirm('开始新记录会替换当前记录。请先导出需要保留的数据，是否继续？'))return;
  try{await device.start(Number($('capture-hz').value),$('capture-type').value==='batch'?Number($('capture-points').value):0);}
  catch(error){showCaptureError(error.message);}
}
async function connectDevice(kind, options){
  try{
    if(device.connected){await device.disconnect();return;}
    await device.connect(kind, options);
  }catch(error){showCaptureError(error.message);}
}
function updateDeviceButtons(){
  const bleSupported=window.isSecureContext&&Boolean(navigator.bluetooth);
  const usbSupported=window.isSecureContext&&Boolean(navigator.serial);
  const locked=device.busy||device.closing;
  $('ble-connect').disabled=locked||(!device.connected&&!bleSupported);
  $('ble-connect').textContent=device.connected?'断开设备':device.lastBle?'重新连接蓝牙':'连接蓝牙';
  $('usb-connect').disabled=locked||device.connected||!usbSupported;
  $('ble-choose').hidden=!bleSupported||device.connected||!device.lastBle;
  $('ble-choose').disabled=locked;
  const transport=device.kind==='ble'?'蓝牙':'USB';
  const hint=bleSupported?'开发板需通电。':usbSupported?'浏览器不支持蓝牙，可使用 USB。':'请在桌面 Chrome 中通过 localhost 或 HTTPS 打开。';
  $('connection-status').textContent=device.closing?'正在断开…':device.busy&&!device.connected?`正在连接${transport}…`:device.ready?`${transport}已连接`:device.error||device.status||hint;
  $('capture-start').disabled=!device.ready||locked||device.recording;
  $('capture-stop').disabled=!device.recording||locked;
  for(const id of ['capture-hz','capture-type','capture-points'])$(id).disabled=device.recording||locked;
  $('capture-points-label').hidden=$('capture-type').value!=='batch';
}

function bindEvents() {
  $('next-sample').addEventListener('click',()=>{if(state.data){selectSample((state.selected+1)%currentSamples().length,true);state.behaviorProgress=0;setBehaviorPlaying(true);}});
  $('capture-play').addEventListener('click',()=>{
    if(!state.capture||device.hasSession)return;
    state.capturePlaying=!state.capturePlaying;if(state.capturePlaying){if(state.captureProgress>=1)state.captureProgress=0;state.captureStarted=performance.now()-state.captureProgress*captureDuration()*1000;}renderCapture();
  });
  $('capture-seek').addEventListener('input',event=>{state.capturePlaying=false;state.captureProgress=Number(event.target.value)/1000;renderCapture();});
  $('capture-reset').addEventListener('click',()=>{
    if(device.recording||device.busy){toast('请先停止记录');return;}
    if(device.dirty&&!confirm('返回示例会清空本次记录，请先导出CSV。是否继续？'))return;
    device.hasSession=false;device.samples=[];device.dirty=false;device.error='';device.parser.reset();
    state.capturePlaying=false;state.captureProgress=device.connected?1:0;renderCapture();
  });
  $('capture-download').addEventListener('click',()=>{if(state.capture)exportCapture();});
  $('capture-start').addEventListener('click',startCapture);
  $('capture-stop').addEventListener('click',()=>device.stop().catch(error=>showCaptureError(error.message)));
  $('capture-type').addEventListener('change',updateDeviceButtons);
  $('behavior-play').addEventListener('click',()=>{if(state.data)setBehaviorPlaying(!state.behaviorPlaying);});
  $('run-inference').addEventListener('click',()=>{if(state.data){state.behaviorProgress=0;setBehaviorPlaying(true);}});
  $('behavior-seek').addEventListener('input',event=>{setBehaviorPlaying(false);state.behaviorProgress=Number(event.target.value);updateBehaviorPosition();drawBehavior();});
  $('view-image').addEventListener('click',()=>{const s=currentSample();if(!s)return;$('original-image').src=s.image;$('original-image').alt=`样本的${s.signal[0].length}通道波形`;$('image-dialog-title').textContent=`样本 ${String(s.number).padStart(2,'0')} · ${labels[s.label]} · 原始波形图`;$('image-dialog').showModal();});
  document.querySelectorAll('.dialog-close').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
  $('ble-connect').addEventListener('click',()=>connectDevice('ble'));
  $('usb-connect').addEventListener('click',()=>connectDevice('usb'));
  $('ble-choose').addEventListener('click',()=>connectDevice('ble',{chooseDevice:true}));
  updateDeviceButtons();
  $('behavior-signal').addEventListener('pointermove',event=>{
    const s=currentSample();if(!s||event.pointerType==='touch')return;
    const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    const {last,hz}=sampleTiming();
    const index=Math.max(0,Math.min(last,Math.round((x-29)/(rect.width-37)*last)));state.hover=index;
    const tip=$('signal-tooltip');tip.hidden=false;
    const values=s.signal[index];
    const lines=['AX','AY','AZ'].map((axis,i)=>`${axis} ${values[i].toFixed(3)}`+
      (values.length===6?`  G${axis[1]} ${values[i+3].toFixed(2)}`:''));
    tip.textContent=[`${(index/hz).toFixed(2)} s`,...lines].join('\n');
    tip.style.left=Math.max(0,Math.min(rect.width-190,x+12))+'px';tip.style.top=Math.max(0,Math.min(rect.height-90,y-75))+'px';drawBehavior();
  });
  $('behavior-signal').addEventListener('pointerleave',()=>{state.hover=null;$('signal-tooltip').hidden=true;drawBehavior();});
  let resizeQueued=false;new ResizeObserver(()=>{if(!resizeQueued){resizeQueued=true;requestAnimationFrame(()=>{renderCapture();drawBehavior();heroFrame(performance.now());resizeQueued=false;});}}).observe(document.body);
  window.addEventListener('beforeunload',event=>{if(device.dirty){event.preventDefault();event.returnValue='';}});
}

async function loadData(path){const response=await fetch(path);if(!response.ok)throw new Error('无法载入 '+path);return response.json();}
async function init(){
  bindEvents();requestAnimationFrame(frame);
  const results=await Promise.allSettled([loadData('assets/data/capture.json'),loadData('assets/data/samples.json?v=feed-r1')]);
  if(results[0].status==='fulfilled'){state.capture=results[0].value;renderCapture();}else{showCaptureError('采集数据载入失败。请通过本地 HTTP 服务打开页面并刷新。');}
  if(results[1].status==='fulfilled'){
    state.data=results[1].value;
    for(const [species,id] of [['dog','behavior-gallery'],['cat','cat-gallery']]){
      const set=state.data.sets[species];
      window.GoCollarsBehaviors.mount($(id),set.classes,labels,label=>{
        state.species=species;
        const index=currentSamples().findIndex(sample=>sample.label===label);
        if(index>=0){selectSample(index);state.behaviorProgress=0;setBehaviorPlaying(true);}
      },species);
    }
    selectSample(0);
  }else{$('signal-title').textContent='样本载入失败';toast('样本数据载入失败，请检查本地服务。');}

}
init();
