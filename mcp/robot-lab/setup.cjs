'use strict';
// One preparation path for the desktop UI and the standalone MCP. Never changes
// system Python, PATH or an explicitly selected environment.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {createHash,randomUUID}=require('node:crypto');
const cache=require(fs.existsSync(path.join(__dirname,'policy-cache.cjs'))?path.join(__dirname,'policy-cache.cjs'):path.resolve(__dirname,'../../src/robots/duck/policy-cache.js'));
const UV_VERSION='0.8.22';
const UV_ASSETS={
 'darwin-arm64':['aarch64-apple-darwin.tar.gz','3f61099e261e449527141dbf125629fab33ad696468c8c90cebbac40185a306c'],
 'darwin-x64':['x86_64-apple-darwin.tar.gz','76638fdcfa91357858771551a1c88de1f7c3b270b33ab1866f8a0618d9e442d8'],
 'win32-x64':['x86_64-pc-windows-msvc.zip','5049375aa2a5162f132b2c1cb992e25d42d47d934cab8c174dbe6f60973dcc12'],
 'linux-x64':['x86_64-unknown-linux-gnu.tar.gz','741ff1f5742c5a4a25d2f829e8395355e43f7a5ae2ebc6368e9ae2df0efb69cf'],
};
const DEPENDENCIES=['numpy==2.4.1','mujoco==3.10.0','onnx==1.22.0','onnxruntime==1.24.4'];
const PROBE=`import json, sys, torch, mujoco, onnx, onnxruntime, numpy
requested=json.loads(sys.argv[1])
for device in requested:
    if device == 'cuda' and not torch.cuda.is_available(): raise RuntimeError('CUDA 不可用：请更新 NVIDIA 驱动，并确认使用 CUDA 版 PyTorch；未切换到 CPU。')
    if device == 'mps' and not torch.backends.mps.is_available(): raise RuntimeError('MPS 不可用：需要受支持的 Apple Silicon 和 macOS；未切换到 CPU。')
    x=torch.ones((2,2),device=device,requires_grad=True); (x*x).sum().backward()
    if not torch.isfinite(x.grad).all(): raise RuntimeError('设备计算验证失败')
print(json.dumps({'python':sys.executable,'torch':torch.__version__,'devices':requested}))`;
function run(executable,args,{env=process.env,signal,onOutput=()=>{},timeout=20*60*1000}={}) {
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe'],signal});
  let output='',errors='',launchError=null;
  child.stdout.on('data',b=>{output=(output+b).slice(-16000);onOutput(String(b));});
  child.stderr.on('data',b=>{errors=(errors+b).slice(-16000);onOutput(String(b));});
  const timer=setTimeout(()=>child.kill(),timeout);
  child.once('error',error=>{launchError=error;});
  child.once('close',code=>{clearTimeout(timer);if(launchError)return reject(launchError);code===0?resolve(output):reject(new Error(`执行失败 (${code})：${(errors||output).slice(-2500)}`));});
 });
}
function defaultDevice(platform=process.platform,arch=process.arch){return platform==='darwin'&&arch==='arm64'?'mps':platform==='win32'&&arch==='x64'?'cuda':'cpu';}
function createTrainingSetup({home=os.homedir(),platform=process.platform,arch=process.arch,fetchImpl=fetch,runCommand=run}={}) {
 const runtime=path.join(home,'.duck-on-desk','training-runtime');
 const download=async(url,signal)=>{const r=await fetchImpl(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});if(!r.ok)throw Error(`下载失败 HTTP ${r.status}；检查网络后重试。`);return Buffer.from(await r.arrayBuffer());};
 const managedPython=backend=>path.join(runtime,`py312-torch291-${backend}`,platform==='win32'?'Scripts/python.exe':'bin/python');
 const isManaged=python=>python&&path.relative(runtime,path.resolve(python)).split(path.sep)[0]!== '..'&&!path.isAbsolute(path.relative(runtime,path.resolve(python)));
 async function ensureUv(signal,onProgress){
  const asset=UV_ASSETS[`${platform}-${arch}`];
  if(!asset)throw Error('此系统暂不支持自动安装，请填写已配置好的 Python 环境。Windows NVIDIA 训练请使用 x64 安装版。');
  const binary=path.join(runtime,'tools',`uv-${UV_VERSION}`,platform==='win32'?'uv.exe':'uv');
  if(fs.existsSync(binary))return binary;
  onProgress('安装环境管理工具（首次下载）');
  const bytes=await download(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${asset[0]}`,signal);
  if(createHash('sha256').update(bytes).digest('hex')!==asset[1])throw Error('环境工具下载校验失败，请重试。');
  const temporary=path.join(runtime,`download-${randomUUID()}`);fs.mkdirSync(temporary,{recursive:true});
  try{
   const archive=path.join(temporary,asset[0]);fs.writeFileSync(archive,bytes);
   await runCommand('tar',['-xf',archive,'-C',temporary],{signal});
   const unpacked=platform==='win32'?path.join(temporary,'uv.exe'):path.join(temporary,`uv-${asset[0].replace('.tar.gz','')}`,'uv');
   fs.mkdirSync(path.dirname(binary),{recursive:true});fs.copyFileSync(unpacked,binary);if(platform!=='win32')fs.chmodSync(binary,0o755);
   return binary;
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
 }
 async function lock(signal,onProgress){
  fs.mkdirSync(runtime,{recursive:true});const file=path.join(runtime,'setup.lock');
  for(let i=0;i<1800;i++){
   signal?.throwIfAborted();
   try{const fd=fs.openSync(file,'wx');fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);return()=>fs.rmSync(file,{force:true});}
   catch(error){if(error.code!=='EEXIST')throw error;
    try{const pid=Number(fs.readFileSync(file,'utf8'));if(Number.isInteger(pid)&&pid>0)process.kill(pid,0);else if(Date.now()-fs.statSync(file).mtimeMs>60000)fs.rmSync(file,{force:true});}
    catch(e){if(e.code==='ESRCH')fs.rmSync(file,{force:true});else if(e.code!=='ENOENT')throw e;}
    onProgress('等待另一个窗口完成环境准备');await new Promise(r=>setTimeout(r,1000));
   }
  }throw Error('等待环境安装超时，请关闭其他训练窗口后重试。');
 }
 async function prepare(config,onProgress=()=>{},signal){
  const devices=[...new Set([config.training_device,config.inference_device])];
  if(devices.some(d=>!['mps','cuda','cpu'].includes(d)))throw Error('不支持的训练设备');
  if(devices.includes('mps')&&platform!=='darwin')throw Error('MPS 仅适用于 Apple Silicon；Windows NVIDIA 请选择 CUDA。');
  if(devices.includes('cuda')&&platform==='darwin')throw Error('CUDA 需要 NVIDIA GPU；Apple Silicon 请选择 MPS。');
  if(!fs.existsSync(path.join(config.asset_dir,'robot_allcollisions.xml')))throw Error('安装包缺少机器人仿真资源 robot_allcollisions.xml，请重新安装完整版本。');
  const canonical=path.join(cache.policyDirectory(home),'BEST_alpha_walking.onnx');
  if(!fs.existsSync(config.base_policy)){
   if(config.base_policy!==canonical)throw Error('指定的基础策略文件不存在，请检查模型路径。');
   onProgress('下载 Microduck 官方基础策略');
   await cache.ensureCachedPolicy('pet-model://policy/BEST_alpha_walking.onnx',{homeDir:home,fetchImpl,signal});
  }
  let python=String(config.pythonPath||'');
  if(python&&/[\0\r\n]/.test(python))throw Error('无效的 Python 路径');
  const backend=devices.includes('cuda')?'cuda':devices.includes('mps')?'mps':'cpu';
  const env={...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',PYTORCH_ENABLE_MPS_FALLBACK:'0',UV_NO_CONFIG:'1',UV_PYTHON_INSTALL_DIR:path.join(home,'.cache','duck-on-desk','python'),UV_CACHE_DIR:path.join(home,'.cache','uv')};
  delete env.PYTHONHOME;delete env.PYTHONPATH;
  const probe=async p=>{onProgress('检查 Python 依赖与实际 GPU 计算');return JSON.parse(await runCommand(p,['-B','-c',PROBE,JSON.stringify(devices)],{env,signal,timeout:120000}));};
  if(python&&!isManaged(python)){
   try{await probe(python);}catch(error){throw Error(`自定义 Python 环境检查失败：${error.message}\n可清空“Python 环境”后重试，由应用自动安装独立环境。`);}
  }else{
   if(platform==='darwin'&&arch==='x64')throw Error('Intel Mac 请填写自定义 Python 环境；自动训练环境当前支持 Apple Silicon、Windows x64 与 Linux x64。');
   python=managedPython(backend);
   const release=await lock(signal,onProgress);
   try{
    const marker=path.join(path.dirname(path.dirname(python)),'ready.json');
    if(fs.existsSync(python)&&fs.existsSync(marker)){
     await probe(python);
    }else{
     const uv=await ensureUv(signal,onProgress);
     onProgress('安装 Python 3.12 并创建独立训练环境');
     if(!fs.existsSync(python))await runCommand(uv,['venv','--python','3.12','--managed-python',path.dirname(path.dirname(python))],{env,signal});
     onProgress(`安装 PyTorch 2.9.1 · ${backend.toUpperCase()}（CUDA 下载较大，请保持网络连接）`);
     const index=platform==='darwin'?'https://pypi.org/simple':`https://download.pytorch.org/whl/${backend==='cuda'?'cu128':'cpu'}`;
     await runCommand(uv,['pip','install','--python',python,'torch==2.9.1','--index-url',index],{env,signal});
     onProgress('安装 MuJoCo、ONNX 和训练依赖');
     await runCommand(uv,['pip','install','--python',python,...DEPENDENCIES,'--index-url','https://pypi.org/simple'],{env,signal});
     const result=await probe(python);fs.writeFileSync(marker,JSON.stringify(result));
    }
   }finally{release();}
  }
  signal?.throwIfAborted();onProgress('训练环境与模型已就绪');
  return {pythonPath:python,base_policy:config.base_policy};
 }
 return {prepare,managedPython};
}
module.exports={createTrainingSetup,defaultDevice,UV_VERSION,UV_ASSETS,DEPENDENCIES};
