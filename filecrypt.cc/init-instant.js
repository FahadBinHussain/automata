// instant filecrypt PoW — deepseek-style offline via window.__fcSolve hook
// injected via Page.addScriptToEvaluateOnNewDocument
// replaces pow_captcha_worker.js; solver is set via window.__fcSolution by CDP

(function(){
  const OrigWorker = window.Worker;
  window.__fcPatched = true;
  window.__fcSolution = null;
  window.__fcSolve = function(challenge, difficulty){
    // called by CDP to solve externally (python); returns promise that worker polls
    // CDP will set window.__fcSolution = nonce after solving
    return new Promise(res=>{
      const t0=Date.now();
      const check=()=>{
        if(window.__fcSolution!==null){ const n=window.__fcSolution; window.__fcSolution=null; res(n); }
        else if(Date.now()-t0>60000) res(null);
        else setTimeout(check,100);
      };
      check();
    });
  };
  window.Worker = function(url, opts){
    const isPow = String(url).includes('pow_captcha');
    if(!isPow) return new OrigWorker(url, opts);
    let onmessage=null, onerror=null;
    const mock = {
      __fcMock: true,
      set onmessage(fn){ onmessage=fn; },
      get onmessage(){ return onmessage; },
      set onerror(fn){ onerror=fn; },
      get onerror(){ return onerror; },
      postMessage(data){
        if(data && data.cmd==='start'){
          const {challenge, difficulty} = data;
          // expose to CDP and wait for solution set via window.__fcSolution
          window.__fcChallenge = challenge;
          window.__fcDifficulty = difficulty;
          window.__fcSolution = null;
          const tStart = Date.now();
          // notify CDP via console
          console.log('[instant] need solve', challenge, difficulty);
          // poll for solution (CDP will set it after python solve)
          const waitForSolve = ()=>{
            if(window.__fcSolution!==null){
              const nonce = window.__fcSolution;
              window.__fcSolution=null;
              const elapsed = Date.now() - tStart;
              if(onmessage) onmessage({data:{type:'done', nonce:nonce, hashes:nonce+1, ms:elapsed, pauses:0}});
            } else {
              setTimeout(waitForSolve, 100);
            }
          };
          // also allow CDP to directly call fetch via python http if available (fallback)
          // try localhost http if CDP doesn't set within 2s (mixed-content may fail, so fallback to polling)
          setTimeout(waitForSolve, 100);
        } else if(data && data.cmd==='pause'){ }
        else if(data && data.cmd==='resume'){ }
        else if(data && data.cmd==='stop'){ }
      },
      terminate(){},
      addEventListener(type, fn){ if(type==='message') onmessage=fn; if(type==='error') onerror=fn; },
      removeEventListener(){}
    };
    return mock;
  };
  window.Worker.toString = ()=>'function Worker() { [native code] }';
  console.log('[instant] Worker patched, waiting for CDP solve via window.__fcSolution');
})();
