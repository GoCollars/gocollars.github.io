/* GoCollars USB/BLE transport and firmware V2 stream parser. No backend required. */
(function(root) {
  'use strict';
  const SERVICE='6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const RX='6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  const TX='6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  const COLUMNS=['board_ms','ax_g','ay_g','az_g','gx_deg_s','gy_deg_s','gz_deg_s','sequence','board_us','missed_total'];
  class StreamParser {
    constructor() { this.reset(); }
    reset() { this.previousSeq=null; this.previousUs=null; this.unwrappedUs=0; this.dropped=0; this.missed=0; }
    sample(line) {
      const fields=line.split(',');
      if(fields.length!==10||fields[0]!=='IMU2'||fields.slice(1).some(v=>!v.trim()))throw new Error('六轴数据格式错误');
      const [seq,us,missed,...values]=fields.slice(1).map(Number);
      if(![seq,us,missed].every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff)||!values.every(Number.isFinite))throw new Error('设备返回了无效数据');
      if(this.previousSeq===null){this.dropped=seq;this.unwrappedUs=us;}
      else {
        const ds=(seq-this.previousSeq)>>>0,dt=(us-this.previousUs)>>>0;
        if(!ds||ds>=0x80000000||!dt||dt>=0x80000000)throw new Error('设备时间戳或序号重置，请导出后重新连接');
        this.dropped+=ds-1;this.unwrappedUs+=dt;
      }
      if(missed<this.missed)throw new Error('设备漏采计数重置');
      this.previousSeq=seq;this.previousUs=us;this.missed=missed;
      return [Math.floor(this.unwrappedUs/1000),...values,seq,this.unwrappedUs,missed];
    }
  }
  class Connection {
    constructor(onChange=()=>{}) {
      this.onChange=onChange;this.parser=new StreamParser();this.samples=[];this.hasSession=false;this.dirty=false;
      this.connected=false;this.ready=false;this.recording=false;this.busy=false;this.closing=false;
      this.kind='usb';this.sessionKind='usb';this.hz=100;this.count=0;this.status='';this.error='';this.buffer='';this.waiter=null;this.lastSample=0;
    }
    emit() { this.onChange(this); }
    fail(message) {
      this.error=message;this.ready=false;this.recording=false;clearInterval(this.watchdog);
      if(this.waiter){this.waiter.reject(new Error(message));this.waiter=null;}
      this.emit();
    }
    feed(bytes) {
      try {
        this.buffer+=new TextDecoder().decode(bytes);
        let end;
        while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end).trim();this.buffer=this.buffer.slice(end+1);if(line)this.line(line);}
        if(this.buffer.length>4096)throw new Error('设备数据帧过长');
      } catch(error) { this.write('x').catch(()=>{});this.fail(error.message); }
    }
    line(line) {
      if(line.startsWith('ERR,'))throw new Error('开发板报告：'+line);
      if(this.waiter&&line.startsWith(this.waiter.prefix)) {const waiter=this.waiter;this.waiter=null;waiter.resolve(line);return;}
      if(line.startsWith('IMU2,')&&this.recording) {
        this.samples.push(this.parser.sample(line));this.lastSample=performance.now();this.dirty=true;
        if(this.samples.length>=100000){this.status='已达到100,000点上限，请导出后开始新记录';this.stop().catch(e=>this.fail(e.message));}
      } else if(line.startsWith('DONE,')&&this.recording) {
        const [,count,missed]=line.split(',').map((v,i)=>i?Number(v):v);
        this.recording=false;clearInterval(this.watchdog);
        if(count!==this.count||missed||this.parser.dropped||this.samples.length!==this.count)this.error='批次不完整：请检查序号缺失和板端漏采，已收到的数据可以导出。';
        this.status=this.error?'批次结束，存在缺失':'批次完成';this.emit();
      }
    }
    async write(command) {
      const data=new TextEncoder().encode(command);
      if(this.kind==='usb') {if(!this.writer)throw new Error('USB未连接');await this.writer.write(data);}
      else {if(!this.rx||!this.ble?.gatt.connected)throw new Error('蓝牙未连接');await this.rx.writeValueWithResponse(data);}
    }
    async request(command,prefix,timeout=5000) {
      if(this.waiter)throw new Error('上一条设备指令尚未完成');
      let timer;
      const response=new Promise((resolve,reject)=>{
        this.waiter={prefix,resolve,reject};timer=setTimeout(()=>{this.waiter=null;reject(new Error('设备回应超时，请检查连接与固件'));},timeout);
      });
      // Observe rejection even when the write itself fails before awaiting the reply.
      response.catch(()=>{});
      try {await this.write(command);return await response;}
      finally {clearTimeout(timer);this.waiter=null;}
    }
    async connect(kind) {
      if(this.busy||this.connected)return;
      this.kind=kind;this.busy=true;this.error='';this.closing=false;this.buffer='';this.emit();
      try {
        if(kind==='usb') {
          if(!navigator.serial)throw new Error('请使用支持USB串口的桌面Chrome或Edge');
          // Device chooser must remain in the original click gesture.
          this.port=await navigator.serial.requestPort({filters:[{usbVendorId:0x2886}]});
          await this.port.open({baudRate:115200});await this.port.setSignals({dataTerminalReady:true});
          this.writer=this.port.writable.getWriter();this.reader=this.port.readable.getReader();
          const reader=this.reader;
          this.readTask=(async()=>{try {while(true){const {value,done}=await reader.read();if(done)break;this.feed(value);}}
            catch(error){if(!this.closing)this.fail('USB接收中断：'+error.message);}
            finally{reader.releaseLock();if(!this.closing)this.fail('USB已断开，已有记录可导出');}})();
        } else {
          if(!navigator.bluetooth)throw new Error('当前浏览器不支持BLE，请用Mac上的Chrome');
          this.ble=await navigator.bluetooth.requestDevice({filters:[{name:'GoCollars-IMU',services:[SERVICE]}]});
          this.onDisconnect=()=>{if(!this.closing)this.fail('蓝牙已断开，已有记录可导出；请断开后重新连接');};
          this.ble.addEventListener('gattserverdisconnected',this.onDisconnect);
          const server=await this.ble.gatt.connect(),service=await server.getPrimaryService(SERVICE);
          this.rx=await service.getCharacteristic(RX);this.tx=await service.getCharacteristic(TX);
          this.onNotify=event=>this.feed(new Uint8Array(event.target.value.buffer,event.target.value.byteOffset,event.target.value.byteLength));
          this.tx.addEventListener('characteristicvaluechanged',this.onNotify);await this.tx.startNotifications();
        }
        this.connected=true;
        await this.request('x','STOP,');
        if(await this.request('?','PONG,')!=='PONG,GO_COLLARS_XIAO_IMU_V1')throw new Error('设备不是兼容的GoCollars固件');
        if(await this.request('v','CAPS,')!=='CAPS,STREAM100_V2,208')throw new Error('请先烧录支持多频率采集的最新固件');
        this.ready=true;this.status='已连接，等待开始记录';
      } catch(error) {
        await this.disconnect();
        if(!['NotFoundError','NotAllowedError'].includes(error.name))this.error=error.message;
        else this.status='连接已取消或未获授权';
      } finally {this.busy=false;this.emit();}
    }
    async start(hz=100,count=0) {
      if(!this.ready||this.busy||this.recording)throw new Error('请先连接设备并停止上一轮采集');
      if(![10,20,25,50,100,200].includes(hz)||!Number.isInteger(count)||count<0||count>60000)throw new Error('采样参数无效');
      this.busy=true;this.error='';this.sessionKind=this.kind;this.hz=hz;this.count=count;this.samples=[];this.parser.reset();this.hasSession=true;this.dirty=false;
      this.recording=true;this.lastSample=performance.now();this.status='正在采集';this.emit();
      try {
        if(await this.request(`c${hz},${count}\n`,'STREAM,')!==`STREAM,${hz}`)throw new Error('设备采样率回应不符');
        this.watchdog=setInterval(()=>{if(this.recording&&performance.now()-this.lastSample>5000){this.write('x').catch(()=>{});this.fail('超过5秒未收到数据，采集已停止，已有记录可导出');}},500);
      } catch(error){this.write('x').catch(()=>{});this.fail(error.message);throw error;}
      finally{this.busy=false;this.emit();}
    }
    async stop() {
      if(!this.recording)return;
      this.busy=true;this.recording=false;clearInterval(this.watchdog);this.emit();
      try {await this.request('x','STOP,');this.status='已停止，数据可导出';}
      catch(error){this.fail(error.message);throw error;}
      finally{this.busy=false;this.emit();}
    }
    async disconnect() {
      this.closing=true;
      try {await this.stop();}catch(_error){}
      clearInterval(this.watchdog);
      if(this.reader){try{await this.reader.cancel();await this.readTask;}catch(_error){}this.reader=null;}
      if(this.writer){try{this.writer.releaseLock();}catch(_error){}this.writer=null;}
      if(this.port){try{await this.port.close();}catch(_error){}this.port=null;}
      if(this.tx){this.tx.removeEventListener('characteristicvaluechanged',this.onNotify);try{await this.tx.stopNotifications();}catch(_error){}this.tx=null;}
      if(this.ble){this.ble.removeEventListener('gattserverdisconnected',this.onDisconnect);this.ble.gatt.disconnect();this.ble=null;}
      this.rx=null;this.connected=this.ready=this.recording=false;this.buffer='';this.status='设备已断开，已有记录保留';this.closing=false;this.emit();
    }
    csv() {return COLUMNS.join(',')+'\n'+this.samples.map(row=>row.join(',')).join('\n')+'\n';}
  }
  const api={Connection,StreamParser,COLUMNS,SERVICE,RX,TX};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.GoCollarsDevice=api;
})(typeof window==='undefined'?globalThis:window);
