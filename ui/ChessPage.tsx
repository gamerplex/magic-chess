"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { ChessOnChain } from "./chain";
import dynamic from "next/dynamic";
import "./magic.css";

const Chess3DBoard = dynamic(() => import("./Chess3DBoard"), { ssr: false });

// ============================================================================
// Chess Piece Rendering
// ============================================================================
const PIECES:Record<number,string>={0:"",2:"♙",3:"♟",4:"♖",5:"♜",6:"♘",7:"♞",8:"♗",9:"♝",10:"♕",11:"♛",12:"♔",13:"♚"};
const PN:Record<number,string>={2:"",3:"",4:"R",5:"R",6:"N",7:"N",8:"B",9:"B",10:"Q",11:"Q",12:"K",13:"K"};
const isW=(p:number)=>p>0&&p%2===0;
const isB=(p:number)=>p>0&&p%2===1;
const same=(a:number,b:number)=>a>0&&b>0&&a%2===b%2;
const pt=(p:number)=>p&0xFE;

// ============================================================================
// Board + Rules (client-side mirror of on-chain program)
// ============================================================================
function initBoard(){const b=Array(64).fill(0);b[0]=4;b[1]=6;b[2]=8;b[3]=10;b[4]=12;b[5]=8;b[6]=6;b[7]=4;for(let i=8;i<16;i++)b[i]=2;for(let i=48;i<56;i++)b[i]=3;b[56]=5;b[57]=7;b[58]=9;b[59]=11;b[60]=13;b[61]=9;b[62]=7;b[63]=5;return b;}
function pathClear(f:number,t:number,b:number[]){const fr=f>>3,fc=f&7,tr=t>>3,tc=t&7,rs=Math.sign(tr-fr),cs=Math.sign(tc-fc);let r=fr+rs,c=fc+cs;while(r!==tr||c!==tc){if(b[r*8+c])return false;r+=rs;c+=cs;}return true;}
function isAttacked(b:number[],sq:number,byW:boolean){for(let i=0;i<64;i++){const p=b[i];if(!p||byW!==isW(p))continue;const t=pt(p),dr=Math.abs((sq>>3)-(i>>3)),dc=Math.abs((sq&7)-(i&7));if(t===6&&((dr===2&&dc===1)||(dr===1&&dc===2)))return true;if(t===2){const dir=byW?1:-1;if((sq>>3)-(i>>3)===dir&&dc===1)return true;}if(t===12&&dr<=1&&dc<=1&&(dr+dc)>0)return true;if((t===4&&(dr===0||dc===0))||(t===8&&dr===dc&&dr>0)||(t===10&&((dr===0||dc===0)||(dr===dc))&&(dr+dc)>0)){if(pathClear(i,sq,b))return true;}}return false;}
function getValid(b:number[],from:number,ep:number,castle:number){const p=b[from];if(!p)return[];const w=isW(p),t=pt(p),r=from>>3,c=from&7,m:number[]=[];const add=(r:number,c:number)=>{if(r<0||r>7||c<0||c>7)return false;const i=r*8+c;if(same(p,b[i]))return false;if(!b[i]){m.push(i);return true;}m.push(i);return false;};const line=(dr:number,dc:number)=>{for(let i=1;i<8;i++){if(!add(r+dr*i,c+dc*i)||b[(r+dr*i)*8+(c+dc*i)])break;}};
switch(t){case 2:{const d=w?1:-1,s=w?1:6,nr=r+d;if(nr>=0&&nr<=7&&!b[nr*8+c]){m.push(nr*8+c);if(r===s&&!b[(r+d*2)*8+c])m.push((r+d*2)*8+c);}[-1,1].forEach(dc=>{const nc=c+dc;if(nr<0||nr>7||nc<0||nc>7)return;const i=nr*8+nc;if(b[i]>0&&!same(p,b[i]))m.push(i);if(i===ep)m.push(i);});break;}case 4:line(1,0);line(-1,0);line(0,1);line(0,-1);break;case 6:[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([a,b])=>add(r+a,c+b));break;case 8:line(1,1);line(1,-1);line(-1,1);line(-1,-1);break;case 10:line(1,0);line(-1,0);line(0,1);line(0,-1);line(1,1);line(1,-1);line(-1,1);line(-1,-1);break;case 12:{[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([a,b])=>add(r+a,c+b));if(w){if(castle&1&&!b[5]&&!b[6]&&!isAttacked(b,4,false)&&!isAttacked(b,5,false)&&!isAttacked(b,6,false))m.push(6);if(castle&2&&!b[1]&&!b[2]&&!b[3]&&!isAttacked(b,4,false)&&!isAttacked(b,3,false)&&!isAttacked(b,2,false))m.push(2);}else{if(castle&4&&!b[61]&&!b[62]&&!isAttacked(b,60,true)&&!isAttacked(b,61,true)&&!isAttacked(b,62,true))m.push(62);if(castle&8&&!b[57]&&!b[58]&&!b[59]&&!isAttacked(b,60,true)&&!isAttacked(b,59,true)&&!isAttacked(b,58,true))m.push(58);}break;}}
const k=w?12:13;return m.filter(to=>{const t2=[...b];t2[to]=p;t2[from]=0;if(pt(p)===2&&to===ep)t2[(to&7)+r*8]=0;if(pt(p)===12&&Math.abs((to&7)-c)===2){if((to&7)===6){t2[r*8+5]=t2[r*8+7];t2[r*8+7]=0;}if((to&7)===2){t2[r*8+3]=t2[r*8+0];t2[r*8+0]=0;}}if(pt(p)===2&&((to>>3)===(w?7:0)))t2[to]=w?10:11;const ks=t2.indexOf(k);return ks>=0&&!isAttacked(t2,ks,!w);});}
function updCastle(c:number,f:number,t:number){let n=c;if(f===4||t===4)n&=0b1100;if(f===60||t===60)n&=0b0011;if(f===0||t===0)n&=0b1101;if(f===7||t===7)n&=0b1110;if(f===56||t===56)n&=0b0111;if(f===63||t===63)n&=0b1011;return n;}
function toAlg(f:number,t:number,p:number,b:number[],cap:boolean){const cs="abcdefgh";if(pt(p)===12&&Math.abs((t&7)-(f&7))===2)return(t&7)===6?"O-O":"O-O-O";return`${pt(p)===2&&cap?cs[f&7]:""}${PN[p]||""}${cap?"x":""}${cs[t&7]}${(t>>3)+1}`;}

// ============================================================================
// Types
// ============================================================================
type Phase="ready"|"playing"|"gameover";
interface TxLog{msg:string;sig?:string;type:"move"|"bet"|"settle"|"system";}

const MOVE_TIME=120;

// ============================================================================
// Component
// ============================================================================
export default function ChessGame(){
  const{publicKey}=useWallet();
  // Mobile detection — collapse sidebars and reduce cell size on small screens
  const[isMobile,setIsMobile]=useState(false);
  useEffect(()=>{
    const check=()=>setIsMobile(window.innerWidth<768);
    check();
    window.addEventListener("resize",check);
    return()=>window.removeEventListener("resize",check);
  },[]);
  const[phase,setPhase]=useState<Phase>("ready");
  const[board,setBoard]=useState(initBoard);
  const[sel,setSel]=useState<number|null>(null);
  const[valid,setValid]=useState<number[]>([]);
  const[wTurn,setWTurn]=useState(true);
  const[mc,setMc]=useState(0);
  const[hist,setHist]=useState<string[]>([]);
  const[captured,setCap]=useState<number[]>([]);
  const[last,setLast]=useState<{f:number,t:number}|null>(null);
  const[won,setWon]=useState<boolean|null>(null);
  const[status,setStatus]=useState("");
  const[streak,setStreak]=useState(()=>parseInt(typeof window!=="undefined"?localStorage.getItem("gp_chess_streak")||"0":"0"));
  const[bestStreak,setBestStreak]=useState(()=>parseInt(typeof window!=="undefined"?localStorage.getItem("gp_chess_best_streak")||"0":"0"));
  const[totalWins,setTotalWins]=useState(()=>parseInt(typeof window!=="undefined"?localStorage.getItem("gp_chess_wins")||"0":"0"));
  const[totalGames,setTotalGames]=useState(()=>parseInt(typeof window!=="undefined"?localStorage.getItem("gp_chess_total")||"0":"0"));
  const[streamMode,setStreamMode]=useState(false);
  const[ep,setEp]=useState(255);
  const[castle,setCastle]=useState(0b1111);
  const[timer,setTimer]=useState(MOVE_TIME);
  const[check,setCheck]=useState(false);
  const[txLogs,setTxLogs]=useState<TxLog[]>([]);
  const[showTx,setShowTx]=useState(!isMobile);
  const[showBets,setShowBets]=useState(!isMobile);
  const[matchStake]=useState(0); // 0 = free play. Set to real value when deposit happens.
  const[matchSettled,setMatchSettled]=useState(false);
  const[matchEventId,setMatchEventId]=useState<string|null>(null);
  const[matchMarket,setMatchMarket]=useState<string|null>(null);
  const isWagered=matchEventId!==null&&matchStake>0; // only true when real money is at stake
  const[cellSize,setCellSize]=useState(typeof window!=="undefined"&&window.innerWidth<768?48:72);
  const[lightMode,setLightMode]=useState(false);
  const[boardTheme,setBoardTheme]=useState<"classic"|"solana"|"magic"|"wood"|"chaos">("magic");
  const[viewMode,setViewMode]=useState<"3d"|"2d">("3d");
  const[shaking,setShaking]=useState(false);
  const[sparkles,setSparkles]=useState<{x:number,y:number,color:string,id:number}[]>([]);
  const[rightTab,setRightTab]=useState<"match"|"moves"|"chat">("match");
  const[chatMessages,setChatMessages]=useState<{from:string,msg:string,time:number}[]>([]);
  const[chatInput,setChatInput]=useState("");
  const[destroyChat,setDestroyChat]=useState(true);
  const[showSaveChatModal,setShowSaveChatModal]=useState(false);
  const[showPlayFair,setShowPlayFair]=useState(false);
  const[experience,setExperience]=useState<null|string>(null);
  const[showResignConfirm,setShowResignConfirm]=useState(false);
  const chatRef=useRef<HTMLDivElement>(null);
  const timerRef=useRef<any>(null);
  const histRef=useRef<HTMLDivElement>(null);
  const txRef=useRef<HTMLDivElement>(null);
  const chainRef=useRef<ChessOnChain|null>(null);

  const addTx=useCallback((msg:string,type:TxLog["type"],sig?:string)=>{
    setTxLogs(l=>[{msg,sig,type},...l.slice(0,49)]);
  },[]);

  // Magic effects
  const spawnSparkles=useCallback((x:number,y:number,count:number=8)=>{
    const colors=["#9945FF","#14F195","#7c4dff","#b388ff","#00e676","#ffd740"];
    const newSparkles=Array.from({length:count},(_,i)=>({
      x:x+(Math.random()-0.5)*60,
      y:y+(Math.random()-0.5)*60,
      color:colors[Math.floor(Math.random()*colors.length)],
      id:Date.now()+i,
    }));
    setSparkles(s=>[...s,...newSparkles]);
    setTimeout(()=>setSparkles(s=>s.filter(sp=>!newSparkles.find(n=>n.id===sp.id))),700);
  },[]);

  const triggerShake=useCallback(()=>{
    setShaking(true);
    setTimeout(()=>setShaking(false),300);
  },[]);

  // Sound effects (Web Audio API — lightweight, no files needed)
  const playSound=useCallback((type:"move"|"capture"|"check"|"castle"|"win"|"lose")=>{
    try{
      const ctx=new AudioContext();
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.connect(gain);gain.connect(ctx.destination);
      const t=ctx.currentTime;
      switch(type){
        case"move":osc.frequency.value=440;gain.gain.setValueAtTime(0.1,t);gain.gain.exponentialRampToValueAtTime(0.001,t+0.08);osc.start(t);osc.stop(t+0.08);break;
        case"capture":osc.type="sawtooth";osc.frequency.value=200;gain.gain.setValueAtTime(0.15,t);gain.gain.exponentialRampToValueAtTime(0.001,t+0.2);osc.start(t);osc.stop(t+0.2);break;
        case"check":osc.frequency.value=880;gain.gain.setValueAtTime(0.12,t);gain.gain.exponentialRampToValueAtTime(0.001,t+0.3);osc.start(t);osc.stop(t+0.15);const o2=ctx.createOscillator();o2.frequency.value=660;o2.connect(gain);o2.start(t+0.15);o2.stop(t+0.3);break;
        case"castle":osc.frequency.value=330;gain.gain.setValueAtTime(0.1,t);gain.gain.exponentialRampToValueAtTime(0.001,t+0.15);osc.start(t);osc.stop(t+0.15);break;
        case"win":osc.frequency.value=523;gain.gain.setValueAtTime(0.15,t);gain.gain.exponentialRampToValueAtTime(0.001,t+0.5);osc.start(t);osc.stop(t+0.5);break;
        case"lose":osc.type="sawtooth";osc.frequency.value=150;gain.gain.setValueAtTime(0.1,t);gain.gain.exponentialRampToValueAtTime(0.001,t+0.4);osc.start(t);osc.stop(t+0.4);break;
      }
    }catch{}
  },[]);

  // AI chat — calls resolver API (key stays server-side, never exposed to browser)
  const RESOLVER=process.env.NEXT_PUBLIC_RESOLVER_URL||"https://resolver.gamerplex.com";
  const getAiChat=useCallback(async(context:string)=>{
    try{
      const res=await fetch(`${RESOLVER}/chat`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({context,game:"chess"}),
      });
      const data=await res.json();
      if(data.ok)return data.message;
    }catch{}
    // Fallback: canned responses (no API needed)
    const lines=["Not bad.","I saw that coming.","Bold strategy.","You sure about that?","My turn now.","Hmm, interesting.","That's what I would've played.","Let's see how this goes.","You're better than I expected.","GG so far.","Your king looks lonely.","Classic opening.","I've seen stronger.","Keep going...","This is getting good."];
    return lines[Math.floor(Math.random()*lines.length)];
  },[RESOLVER]);

  const sendChat=useCallback((msg:string)=>{
    if(!msg.trim())return;
    setChatMessages(m=>[...m,{from:"You",msg:msg.trim(),time:Date.now()}]);
    setChatInput("");
    // AI responds after delay
    setTimeout(async()=>{
      const aiMsg=await getAiChat(`Player said: "${msg}". Game state: move ${mc}, ${wTurn?"white":"black"} to play.`);
      setChatMessages(m=>[...m,{from:"Agent",msg:aiMsg,time:Date.now()}]);
    },800+Math.random()*1200);
  },[getAiChat,mc,wTurn]);

  // AI initiates chat on certain events
  useEffect(()=>{
    if(phase==="playing"&&mc===0){
      setTimeout(async()=>{
        const greeting=await getAiChat("Game just started. Greet the opponent. Be competitive.");
        setChatMessages(m=>[...m,{from:"Agent",msg:greeting,time:Date.now()}]);
      },2000);
    }
  },[phase,mc,getAiChat]);

  // Auto-scroll chat
  useEffect(()=>{chatRef.current?.scrollTo(0,chatRef.current.scrollHeight);},[chatMessages]);

  // Track streaks + stats on game end
  useEffect(()=>{
    if(phase!=="gameover")return;
    // Finish game on ER pool
    const finishOnChain=async()=>{
      if(chainRef.current?.gamePda){
        try{
          const result={winner:won===true?"white" as const:won===false?"black" as const:"draw" as const,moves:mc};
          // If wallet connected, pass it for SOAR score
          const wallet=publicKey?.toBase58();
          const ok=await chainRef.current.finish(wallet,result);
          if(ok){
            addTx(`Game committed to Solana${wallet?" + SOAR score saved":""}`,"settle");
            setMatchSettled(true);
          }else{
            addTx("Game recycled","settle");
            setMatchSettled(true);
          }
        }catch(e:any){
          addTx(`⚠ Finish error: ${e.message}`,"system");
          setMatchSettled(true);
        }
      }else{
        addTx(`Game complete`,"settle");
        setTimeout(()=>setMatchSettled(true),1000);
      }
    };
    finishOnChain();
    addTx(`Match result — ${won?"White wins":won===false?"Black wins":"Draw"} ($${totalPot} pot)`,"settle");
    const newTotal=totalGames+1;
    setTotalGames(newTotal);
    localStorage.setItem("gp_chess_total",newTotal.toString());

    if(won===true){
      const newWins=totalWins+1;
      const newStreak=streak+1;
      setTotalWins(newWins);
      setStreak(newStreak);
      localStorage.setItem("gp_chess_wins",newWins.toString());
      localStorage.setItem("gp_chess_streak",newStreak.toString());
      if(newStreak>bestStreak){
        setBestStreak(newStreak);
        localStorage.setItem("gp_chess_best_streak",newStreak.toString());
      }
      // AI reacts to streak
      if(newStreak>=3){
        getAiChat(`Player is on a ${newStreak}-win streak. React with respect or playful intimidation.`).then(msg=>{
          setChatMessages(m=>[...m,{from:"Agent",msg,time:Date.now()}]);
        });
      }
    }else if(won===false){
      setStreak(0);
      localStorage.setItem("gp_chess_streak","0");
    }
    // Draw: streak unchanged
  },[phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timer
  useEffect(()=>{if(phase!=="playing")return;setTimer(MOVE_TIME);timerRef.current=setInterval(()=>{setTimer(t=>{if(t<=1){clearInterval(timerRef.current);setWon(!wTurn);setPhase("gameover");setStatus(`${wTurn?"White":"Black"} timed out`);addTx("TIMEOUT — game over","system");return 0;}return t-1;});},1000);return()=>clearInterval(timerRef.current);},[phase,wTurn,addTx]);
  useEffect(()=>{histRef.current?.scrollTo(0,histRef.current.scrollHeight);},[hist]);
  useEffect(()=>{txRef.current?.scrollTo(0,0);},[txLogs]);

  const execMove=useCallback((from:number,to:number,b:number[],epSq:number,cas:number)=>{
    const p=b[from],tgt=b[to],w=isW(p),tp=pt(p);const nb=[...b];let nep=255,nc=updCastle(cas,from,to),cap=tgt;
    if(tp===12&&Math.abs((to&7)-(from&7))===2){const row=from>>3;nb[to]=p;nb[from]=0;if((to&7)===6){nb[row*8+5]=nb[row*8+7];nb[row*8+7]=0;}if((to&7)===2){nb[row*8+3]=nb[row*8+0];nb[row*8+0]=0;}}else{nb[to]=p;nb[from]=0;}
    if(tp===2&&to===epSq){const cs=(to&7)+(from>>3)*8;cap=nb[cs];nb[cs]=0;}
    if(tp===2&&Math.abs((to>>3)-(from>>3))===2)nep=((from>>3)+(to>>3))/2*8+(from&7);
    if(tp===2&&((to>>3)===(w?7:0)))nb[to]=w?10:11;
    const alg=toAlg(from,to,p,b,cap>0);
    const ok=w?13:12;const oks=nb.indexOf(ok);let go=false,win=0;
    if(oks>=0){const ic=isAttacked(nb,oks,w);let hl=false;for(let i=0;i<64&&!hl;i++){if(!nb[i]||isW(nb[i])===w)continue;if(getValid(nb,i,nep,nc).length>0)hl=true;}if(!hl){go=true;win=ic?(w?1:2):0;}}
    return{nb,cap,alg:alg+(go&&win?"#":""),nep,nc,go,win};
  },[]);

  const click=useCallback((idx:number)=>{
    if(phase!=="playing"||!wTurn)return;
    if(sel!==null&&valid.includes(idx)){
      const{nb,cap,alg,nep,nc,go,win}=execMove(sel,idx,board,ep,castle);
      setBoard(nb);setLast({f:sel,t:idx});setSel(null);setValid([]);setEp(nep);setCastle(nc);
      if(cap>0){setCap(c=>[...c,cap]);playSound("capture");triggerShake();}else{playSound(alg.includes("O")?"castle":"move");}
      setHist(h=>[...h,alg]);setMc(m=>m+1);setTimer(MOVE_TIME);
      // Send white move to ER (real on-chain transaction)
      if(chainRef.current?.isReady){
        chainRef.current.sendPlayerMove(sel,idx,alg).then(sig=>{
          if(sig)addTx(`White: ${alg}`,"move",sig);
          else addTx(`White: ${alg} (ER pending)`,"move");
        });
      }else{
        addTx(`White: ${alg}`,"move");
      }
      if(go){setWon(win===1);setPhase("gameover");setStatus(win===1?"Checkmate!":win===2?"Checkmate!":"Stalemate");addTx(win?"CHECKMATE":"STALEMATE","system");playSound(win===1?"win":"lose");triggerShake();return;}
      const bk=nb.indexOf(13);const inCheck=bk>=0&&isAttacked(nb,bk,true);setCheck(inCheck);
      if(inCheck)playSound("check");
      setWTurn(false);setStatus(inCheck?"Check! Agent thinking...":"Agent thinking...");
      // AI
      setTimeout(()=>{
        const bp:number[]=[];for(let i=0;i<64;i++)if(isB(nb[i]))bp.push(i);
        type AM={f:number,t:number,s:number};const am:AM[]=[];
        for(const f of bp){const mv=getValid(nb,f,nep,nc);for(const t of mv){let s=0;if(nb[t]>0)s+=10+nb[t];const tt=[...nb];tt[t]=tt[f];tt[f]=0;const wk=tt.indexOf(12);if(wk>=0&&isAttacked(tt,wk,false))s+=5;const tr=t>>3,tc=t&7;if(tr>=2&&tr<=5&&tc>=2&&tc<=5)s+=1;am.push({f,t,s});}}
        if(!am.length){setWon(true);setPhase("gameover");setStatus("Agent has no moves!");addTx("NO MOVES — White wins","system");return;}
        am.sort((a,b)=>b.s-a.s);const pick=am[Math.floor(Math.random()*Math.min(3,am.length))];
        const r=execMove(pick.f,pick.t,nb,nep,nc);
        setBoard(r.nb);setLast({f:pick.f,t:pick.t});setEp(r.nep);setCastle(r.nc);
        if(r.cap>0){setCap(c=>[...c,r.cap]);playSound("capture");triggerShake();}else{playSound(r.alg.includes("O")?"castle":"move");}
        setHist(h=>[...h,r.alg]);setMc(m=>m+1);setTimer(MOVE_TIME);
        // Send AI move to ER via server (server signs as black)
        if(chainRef.current?.isReady){
          chainRef.current.sendAiMove(pick.f,pick.t).then(sig=>{
            if(sig)addTx(`Black: ${r.alg}`,"move",sig);
            else addTx(`Black: ${r.alg} (ER pending)`,"move");
          });
        }else{
          addTx(`Black: ${r.alg}`,"move");
        }
        if(r.go){setWon(r.win===1?true:r.win===2?false:null);setPhase("gameover");setStatus(r.win===1?"Checkmate!":r.win===2?"Checkmate!":"Stalemate");addTx(r.win?"CHECKMATE":"STALEMATE","system");playSound(r.win===1?"win":"lose");triggerShake();return;}
        const wk=r.nb.indexOf(12);const wkCheck=wk>=0&&isAttacked(r.nb,wk,false);setCheck(wkCheck);
        if(wkCheck)playSound("check");
        setWTurn(true);setStatus(wkCheck?"Check!":"Your turn");
      },500+Math.random()*500);
    }else if(isW(board[idx])){setSel(idx);setValid(getValid(board,idx,ep,castle));}
    else{setSel(null);setValid([]);}
  },[phase,board,sel,valid,wTurn,ep,castle,execMove,addTx]);

  const reset=()=>{setBoard(initBoard());setCap([]);setMc(0);setWTurn(true);setSel(null);setValid([]);setStatus("Your turn");setWon(null);setEp(255);setCastle(0b1111);setHist([]);setCheck(false);setTimer(MOVE_TIME);setTxLogs([]);setMatchSettled(false);setMatchEventId(null);setMatchMarket(null);};
  const cols="abcdefgh";
  const tm=Math.floor(timer/60),ts=(timer%60).toString().padStart(2,"0");
  const totalPot=matchStake*2;
  const lm=lightMode;

  return(
    <div style={{minHeight:"100vh",background:lm?"#f5f5f5":"#050508",color:lm?"#222":"#e8e8f0",fontFamily:"'Space Grotesk', sans-serif",transition:"background 0.3s, color 0.3s"}}>
      {/* HEADER */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:streamMode?"6px 12px":"12px 16px",borderBottom:`1px solid ${lm?"#ddd":"#252540"}`,background:lm?"#fff":"transparent"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <Link href="/" style={{textDecoration:"none",fontSize:streamMode?14:16,fontWeight:700,fontStyle:"italic",background:"linear-gradient(135deg, #9945FF, #14F195)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",paddingRight:6,display:"inline-block"}}>GAMERPLEX</Link>
          {/* Devnet badge */}
          <span style={{fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:4,background:"rgba(255,170,0,0.15)",border:"1px solid rgba(255,170,0,0.4)",color:"#ffaa00",letterSpacing:1,textTransform:"uppercase"}}>Devnet</span>
          {/* Streak badge */}
          {streak>0&&(
            <div style={{display:"flex",alignItems:"center",gap:4,background:streak>=5?"rgba(255,215,64,0.15)":streak>=3?"rgba(255,107,44,0.1)":"transparent",padding:"2px 8px",borderRadius:12,border:streak>=3?`1px solid ${streak>=5?"#ffd740":"#ff6b2c"}`:"none"}}>
              <span style={{fontSize:12}}>{streak>=10?"🔥🔥🔥":streak>=5?"🔥🔥":streak>=3?"🔥":""}</span>
              <span style={{fontSize:11,fontWeight:700,color:streak>=5?"#ffd740":streak>=3?"#ff6b2c":"#888"}}>{streak}W</span>
            </div>
          )}
          {/* Player stats (compact) */}
          {totalGames>0&&!streamMode&&(
            <span style={{fontSize:10,color:"#555"}}>{totalWins}W/{totalGames-totalWins}L &bull; Best: {bestStreak}🔥</span>
          )}
        </div>
        <div style={{display:"flex",gap:streamMode?6:10,alignItems:"center"}}>
          {!streamMode&&<>
            <Link href="/games" style={{color:lm?"#888":"#555",textDecoration:"none",fontSize:12}}>Arcade</Link>
            <Link href="/leaderboard" style={{color:lm?"#888":"#555",textDecoration:"none",fontSize:12}}>Leaderboard</Link>
            <Link href="/docs" style={{color:lm?"#888":"#555",textDecoration:"none",fontSize:12}}>Docs</Link>
            <a href="https://x.com/gamerplex_com" target="_blank" rel="noopener noreferrer" style={{color:lm?"#888":"#555",display:"flex",alignItems:"center"}} title="@gamerplex_com">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
          </>}
          {/* Stream mode toggle */}
          <button onClick={()=>setStreamMode(!streamMode)} title={streamMode?"Exit stream mode":"Stream mode (OBS-friendly)"} style={{background:streamMode?"#ff6b2c":"none",border:`1px solid ${streamMode?"#ff6b2c":lm?"#ccc":"#333"}`,borderRadius:6,width:32,height:32,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",color:streamMode?"#000":lm?"#888":"#555"}}>📺</button>
          <button onClick={()=>setLightMode(!lightMode)} title={lm?"Dark mode":"Light mode"} style={{background:"none",border:`1px solid ${lm?"#ccc":"#333"}`,borderRadius:6,width:32,height:32,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>{lm?"🌙":"☀️"}</button>
          {!streamMode&&<WalletMultiButton style={{fontSize:12,height:32}}/>}
        </div>
      </div>

      {/* Tournament Banner (shown when tournament is upcoming) */}
      {(phase==="ready"||phase==="playing")&&(
        <div style={{background:"linear-gradient(90deg, rgba(255,107,44,0.1), rgba(255,215,64,0.1))",borderBottom:`1px solid ${lm?"#ddd":"#252540"}`,padding:"6px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11}}>
          <span style={{color:lm?"#b8860b":"#ffd740",fontWeight:600}}>🏆 Weekly Chess Tournament — Saturday 8pm UTC</span>
          <span style={{color:lm?"#666":"#888"}}>Entry: 50 $CHESS &bull; Prize: $500 pool &bull; <a href="/docs" style={{color:"#448aff",textDecoration:"none"}}>Learn more</a></span>
        </div>
      )}

      {/* READY — Onboarding */}
      {phase==="ready"&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"calc(100vh - 56px)"}}>
          <div style={{textAlign:"center",maxWidth:440}}>
            <div style={{fontSize:64,marginBottom:8}}>🧙‍♂️</div>
            <h1 className="magic-chess-title magic-pulse" style={{fontSize:42,fontWeight:700,marginBottom:8}}>✨ MAGIC CHESS 🪄</h1>
            <p className="magic-chess-text" style={{fontSize:14,marginBottom:4}}>Every move on MagicBlock Ephemeral Rollup</p>
            <p style={{color:"#555",fontSize:11,marginBottom:16}}>Free to play. Connect wallet to save score on-chain forever.</p>

            {/* Experience selector */}
            {!experience&&(
              <div style={{marginBottom:20}}>
                <p style={{color:"#555",fontSize:12,marginBottom:10}}>What is your chess experience?</p>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {[
                    {id:"beginner",label:"I'm learning",icon:"♟",desc:"Easy AI opponent"},
                    {id:"intermediate",label:"I know the rules",icon:"♞",desc:"Medium AI opponent"},
                    {id:"advanced",label:"I know strategies",icon:"♛",desc:"Hard AI opponent"},
                    {id:"expert",label:"Tournament player",icon:"♚",desc:"Maximum difficulty"},
                  ].map(e=>(
                    <button key={e.id} onClick={()=>setExperience(e.id)} style={{
                      display:"flex",alignItems:"center",gap:12,padding:"12px 16px",
                      background:lm?"#f5f5f5":"#14141f",border:`1px solid ${lm?"#ddd":"#252540"}`,
                      borderRadius:8,cursor:"pointer",textAlign:"left",width:"100%",
                      transition:"border-color 0.15s",
                    }}
                    onMouseEnter={e2=>(e2.currentTarget.style.borderColor="#ff6b2c")}
                    onMouseLeave={e2=>(e2.currentTarget.style.borderColor=lm?"#ddd":"#252540")}
                    >
                      <span style={{fontSize:24}}>{e.icon}</span>
                      <div>
                        <div style={{fontSize:14,fontWeight:600,color:lm?"#222":"#e8e8f0"}}>{e.label}</div>
                        <div style={{fontSize:10,color:"#555"}}>{e.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Play button (after experience selected) */}
            {experience&&!showPlayFair&&(
              <div>
                <p style={{color:"#555",fontSize:11,marginBottom:4}}>
                  Level: {experience} &bull; White ♙ vs Agent ♟ &bull; {MOVE_TIME/60} min/move
                </p>
                <p style={{color:"#333",fontSize:10,marginBottom:16}}>
                  Free to play &bull; Save your score on Solana after the game
                </p>
            <button onClick={()=>setShowPlayFair(true)} style={{background:"linear-gradient(135deg, #9945FF, #14F195)",color:"#000",border:"none",padding:"16px 48px",borderRadius:10,fontSize:18,fontWeight:700,cursor:"pointer"}}>
              PLAY NOW
            </button>
            <button onClick={()=>setExperience(null)} style={{background:"none",border:"none",color:"#555",fontSize:11,cursor:"pointer",marginTop:8,display:"block",margin:"8px auto 0"}}>
              ← Change level
            </button>
              </div>
            )}

            {/* Play Fair Modal */}
            {showPlayFair&&(
              <div style={{background:lm?"#fff":"#0c0c14",border:`1px solid ${lm?"#ddd":"#252540"}`,borderRadius:12,padding:24,textAlign:"center",marginTop:8}}>
                <div style={{fontSize:32,marginBottom:8}}>🤝</div>
                <div style={{fontSize:20,fontWeight:700,marginBottom:12}}>Play Fair</div>
                <div style={{fontSize:12,color:"#888",lineHeight:1.8,marginBottom:16,textAlign:"left"}}>
                  <div style={{marginBottom:6}}>Follow these rules to keep chess fun:</div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:4}}>
                    <span style={{background:"#ff6b2c",color:"#000",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700,flexShrink:0}}>1</span>
                    <span>Treat opponents how you want to be treated</span>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:4}}>
                    <span style={{background:"#ff6b2c",color:"#000",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700,flexShrink:0}}>2</span>
                    <span>No external chess engines during wagered matches</span>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:4}}>
                    <span style={{background:"#ff6b2c",color:"#000",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700,flexShrink:0}}>3</span>
                    <span>Finish every game — no quitting or stalling</span>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <span style={{background:"#ff6b2c",color:"#000",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700,flexShrink:0}}>4</span>
                    <span>Save your score on-chain after the game</span>
                  </div>
                </div>
                <div style={{fontSize:10,color:"#555",marginBottom:16}}>
                  Violations may result in reputation loss and stake slashing.
                  By clicking below, you agree to the <a href="/docs" style={{color:"#448aff"}}>Terms of Service</a>.
                </div>
                <button onClick={async()=>{
                  setShowPlayFair(false);
                  reset();
                  const chain=new ChessOnChain();
                  chainRef.current=chain;

                  addTx("🧙‍♂️ Connecting to MagicBlock ER...","system");

                  const assigned=await chain.requestGame();
                  if(assigned&&chain.isReady){
                    addTx(`Game assigned on ER`,"system");
                    addTx(`Game: ${chain.gamePda!.toBase58().slice(0,8)}...`,"system");
                    addTx(`Every move is a real Solana transaction`,"system");
                  }else{
                    addTx("⚠ ER pool busy — playing locally","system");
                  }
                  addTx(`Difficulty: ${experience}`,"system");
                  setPhase("playing");
                }} className="magic-chess-btn" style={{padding:"14px 40px",borderRadius:8,fontSize:16,cursor:"pointer",width:"100%"}}>
                  ✦ I Agree — Start Game ✦
                </button>
              </div>
            )}
            <div style={{marginTop:20,fontSize:11,color:"#333"}}>Program: 3LVg8u...3QYr &bull; MagicBlock ER &bull; Contention Markets</div>
          </div>
        </div>
      )}

      {/* GAME */}
      {(phase==="playing"||phase==="gameover")&&(
        <div style={{position:"relative",height:"calc(100vh - 56px)",overflow:"hidden"}}>

          {/* 3D FULLSCREEN BACKGROUND */}
          {viewMode==="3d"&&(
            <div style={{position:"absolute",inset:0,zIndex:0}}>
              <Chess3DBoard board={board} selected={sel} validMoves={valid} lastMove={last} check={check} phase={phase} onClick={click}/>
            </div>
          )}

          {/* OVERLAY LAYOUT — panels float over 3D */}
          <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:isMobile?"column":"row",height:"100%",pointerEvents:"none"}}>

          {/* LEFT: TX LOG (collapsible, overlay) */}
          <div style={{width:showTx?260:36,transition:"width 0.2s",overflow:"hidden",flexShrink:0,display:"flex",flexDirection:"column",pointerEvents:"auto",background:viewMode==="3d"?(showTx?"rgba(10,0,20,0.85)":"rgba(10,0,20,0.6)"):(lm?"#fafafa":"transparent"),borderRight:viewMode==="3d"?"1px solid rgba(153,69,255,0.2)":`1px solid ${lm?"#ddd":"#252540"}`,backdropFilter:viewMode==="3d"?"blur(12px)":"none"}}>
            <div onClick={()=>setShowTx(!showTx)} style={{padding:"8px",cursor:"pointer",borderBottom:viewMode==="3d"?"1px solid rgba(153,69,255,0.2)":`1px solid ${lm?"#ddd":"#252540"}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              {showTx&&<span className={viewMode==="3d"?"magic-chess-label":""} style={{fontSize:9,fontWeight:900,color:viewMode==="3d"?undefined:(boardTheme==="magic"?"#9945FF":"#18ffff"),letterSpacing:1,textTransform:"uppercase"}}>{chainRef.current?.isReady?"On-Chain Stream":"Game Log"}</span>}
              <span style={{fontSize:12,color:"#888"}}>{showTx?"◀":"▶"}</span>
            </div>
            {showTx&&(
              <div ref={txRef} style={{flex:1,overflowY:"auto",padding:8}}>
                {txLogs.map((tx,i)=>(
                  <div key={i} style={{fontSize:10,fontFamily:"monospace",marginBottom:6,borderLeft:`2px solid ${tx.type==="move"?"#00e676":tx.type==="bet"?"#ffd740":tx.type==="settle"?"#ff6b2c":"#555"}`,paddingLeft:6}}>
                    <div style={{color:tx.type==="system"?"#666":"#e0b3ff"}}>{tx.msg}</div>
                    {tx.sig&&(
                      <a href={`https://explorer.solana.com/tx/${tx.sig}?cluster=custom&customUrl=https%3A%2F%2Fdevnet.magicblock.app`} target="_blank" rel="noopener noreferrer" style={{color:"#448aff",fontSize:8,textDecoration:"underline"}}>
                        TX ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CENTER */}
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:viewMode==="3d"?"flex-start":"center",padding:viewMode==="3d"?"8px 12px":"12px",overflow:viewMode==="3d"?"visible":"auto",pointerEvents:viewMode==="3d"?"none":"auto"}}>
            {/* Controls: 2D/3D toggle + zoom + board theme */}
            <div style={{display:"flex",gap:6,marginBottom:6,alignItems:"center",flexWrap:"wrap",justifyContent:"center",pointerEvents:"auto"}}>
              {/* 2D/3D toggle */}
              <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:"1px solid rgba(153,69,255,0.3)",boxShadow:viewMode==="3d"?"0 0 15px rgba(153,69,255,0.2)":"none"}}>
                <button onClick={()=>setViewMode("3d")} style={{padding:"3px 10px",fontSize:10,fontWeight:700,cursor:"pointer",border:"none",background:viewMode==="3d"?"#7c4dff":(lm?"#eee":"#14141f"),color:viewMode==="3d"?"#fff":(lm?"#666":"#555")}}>3D</button>
                <button onClick={()=>setViewMode("2d")} style={{padding:"3px 10px",fontSize:10,fontWeight:700,cursor:"pointer",border:"none",background:viewMode==="2d"?"#7c4dff":(lm?"#eee":"#14141f"),color:viewMode==="2d"?"#fff":(lm?"#666":"#555")}}>2D</button>
              </div>
              {/* Watch Live Agents link */}
              <a href="/#arena" style={{
                padding:"4px 10px",fontSize:10,fontWeight:700,borderRadius:6,
                background:"rgba(20,241,149,0.1)",border:"1px solid rgba(20,241,149,0.3)",
                color:"#14F195",textDecoration:"none",display:"flex",alignItems:"center",gap:4,
              }} title="Watch live Gamerplex Agents playing">
                <span className="live-dot" style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#14F195"}}/>
                Watch Agents
              </a>
              {viewMode==="2d"&&<>
              <div style={{width:1,height:16,background:lm?"#ccc":"#252540"}}/>
              <button onClick={()=>setCellSize(s=>Math.max(40,s-8))} style={{background:lm?"#ddd":"#14141f",border:`1px solid ${lm?"#bbb":"#252540"}`,borderRadius:4,width:28,height:28,color:lm?"#333":"#888",cursor:"pointer",fontSize:16,fontWeight:700}}>−</button>
              <button onClick={()=>setCellSize(s=>Math.min(96,s+8))} style={{background:lm?"#ddd":"#14141f",border:`1px solid ${lm?"#bbb":"#252540"}`,borderRadius:4,width:28,height:28,color:lm?"#333":"#888",cursor:"pointer",fontSize:16,fontWeight:700}}>+</button>
              <div style={{width:1,height:16,background:lm?"#ccc":"#252540"}}/>
              {(["classic","solana","magic","wood","chaos"] as const).map(t=>(
                <button key={t} onClick={()=>setBoardTheme(t)} style={{
                  padding:"3px 8px",fontSize:9,fontWeight:600,borderRadius:4,cursor:"pointer",
                  textTransform:"capitalize",
                  background:boardTheme===t?(t==="solana"?"#14F195":t==="magic"?"#7c4dff":t==="wood"?"#8B4513":t==="chaos"?"linear-gradient(135deg,#ff0066,#ffd740,#00ffcc)":"#b58863"):(lm?"#eee":"#14141f"),
                  color:boardTheme===t?"#fff":(lm?"#666":"#555"),
                  border:`1px solid ${boardTheme===t?"transparent":(lm?"#ccc":"#252540")}`,
                }}>{t}</button>
              ))}
              </>}
            </div>

            {/* Status bar */}
            <div className="magic-chess-status" style={{display:"flex",justifyContent:"space-between",marginBottom:4,padding:"6px 12px",borderRadius:6,width:viewMode==="3d"?"100%":8*cellSize+20,maxWidth:viewMode==="3d"?600:undefined,fontSize:11,pointerEvents:"auto"}}>
              <span className="magic-chess-label" style={{fontWeight:700}}>{wTurn?"⚪":"⚫"} {status||"Your turn"}</span>
              <span className={timer<15?"timer-urgent":""} style={{fontFamily:"monospace",fontWeight:700,color:timer<30?"#ff1744":timer<60?"#ffd740":"#888"}}>{tm}:{ts}</span>
              <span style={{color:"#9945FF"}}>Move {mc}</span>
            </div>

            {/* 3D: board is fullscreen behind, nothing here */}

            {/* 2D Board */}
            {viewMode==="2d"&&<>
            <div className={`${shaking?"board-shake":""} ${boardTheme==="magic"?"magic-board":""} ${phase==="gameover"&&won?"win-glow":""}`} style={{display:"inline-grid",gridTemplateColumns:`${Math.max(20,cellSize*0.35)}px repeat(8, ${cellSize}px)`,gap:0,border:`2px solid ${boardTheme==="magic"?"#9945FF60":lm?"#999":"#252540"}`,borderRadius:6,boxShadow:lm?"0 4px 20px rgba(0,0,0,0.1)":"0 4px 30px rgba(0,0,0,0.5)",position:"relative"}}>
              <div/>
              {Array.from({length:8},(_,i)=><div key={i} style={{textAlign:"center",fontSize:Math.max(8,cellSize/6),color:lm?"#999":"#555"}}>{cols[i]}</div>)}
              {Array.from({length:8},(_,dr)=>{
                const row=7-dr;
                return <div key={`row${row}`} style={{display:"contents"}}>
                  <div style={{fontSize:Math.max(8,cellSize/6),color:lm?"#999":"#555",display:"flex",alignItems:"center",justifyContent:"center"}}>{row+1}</div>
                  {Array.from({length:8},(_,col)=>{
                    const idx=row*8+col,piece=board[idx],isDark=(row+col)%2===0;
                    const isSel=sel===idx,isVal=valid.includes(idx),isLast=last?.f===idx||last?.t===idx;
                    const isKC=check&&piece===12;
                    const neonPairs=[["#ff0066","#0a0a0a"],["#00ffcc","#0a0a0a"],["#ff6b2c","#0d0d1a"],["#7c4dff","#0a0a0a"],["#18ffff","#0d0015"],["#00e676","#0a0a0a"],["#ff1744","#050510"],["#ffd740","#0a0a0a"]];
                    const chaosPair=neonPairs[mc%neonPairs.length];
                    const chaosNeonBorders=["#ff0066","#00ffcc","#ffd740","#7c4dff","#18ffff","#ff6b2c","#00e676","#ff80ab","#448aff","#ff1744"];
                    const chaosBorder=chaosNeonBorders[(row*8+col+mc)%chaosNeonBorders.length];
                    const themes={
                      classic:  {light:"#f0d9b5",dark:"#b58863",sel:"#ff8c42",lastMove:"rgba(255,200,100,0.5)",wp:"#fff",bp:"#333"},
                      solana:   {light:"#c8f7dc",dark:"#14F195",sel:"#9945FF",lastMove:"rgba(153,69,255,0.3)",wp:"#fff",bp:"#1a1a2a"},
                      magic:    {light:"#d4c5f9",dark:"#7c4dff",sel:"#ff6b2c",lastMove:"rgba(255,107,44,0.3)",wp:"#fff",bp:"#1a0a3a"},
                      wood:     {light:"#deb887",dark:"#8B4513",sel:"#ff6b2c",lastMove:"rgba(255,200,100,0.5)",wp:"#fff",bp:"#2a1506"},
                      chaos:    {light:chaosPair[0],dark:chaosPair[1],sel:"#ff0066",lastMove:"rgba(255,0,102,0.5)",wp:"#fff",bp:"#000"},
                    };
                    const th=lm?themes[boardTheme]:(boardTheme==="classic"?{light:"#252540",dark:"#1a1a28",sel:"#ff6b2c",lastMove:"rgba(255,107,44,0.12)",wp:"#e8e8f0",bp:"#b388ff"}:boardTheme==="magic"?{light:"#2a1548",dark:"#1a0a30",sel:"#14F195",lastMove:"rgba(153,69,255,0.25)",wp:"#e8d0ff",bp:"#14F195"}:themes[boardTheme]);
                    let bg=isDark?th.dark:th.light;
                    if(isSel)bg=th.sel;
                    else if(isKC)bg="rgba(255,23,68,0.35)";
                    else if(isLast)bg=th.lastMove;
                    const pieceColor=piece&&isW(piece)?th.wp:th.bp;
                    const isChaos=boardTheme==="chaos";
                    return<div key={idx} onClick={()=>click(idx)} style={{width:cellSize,height:cellSize,background:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:piece?Math.round(cellSize*0.6):0,cursor:phase==="playing"?"pointer":"default",position:"relative",color:pieceColor,transition:isChaos?"all 0.2s":"all 0.1s",boxShadow:isChaos?`inset 0 0 ${cellSize*0.15}px ${chaosBorder}40`:"none",border:isChaos?`1px solid ${chaosBorder}50`:"none"}}
                    onMouseEnter={e=>{if(isChaos)e.currentTarget.style.transform="scale(1.08) rotate("+(Math.random()*6-3)+"deg)";}}
                    onMouseLeave={e=>{if(isChaos)e.currentTarget.style.transform="scale(1) rotate(0deg)";}}>
                      {PIECES[piece]||""}
                      {isVal&&!piece&&<div style={{width:cellSize*0.2,height:cellSize*0.2,borderRadius:"50%",background:boardTheme==="magic"?"rgba(20,241,149,0.5)":"rgba(0,230,118,0.4)",position:"absolute",boxShadow:boardTheme==="magic"?"0 0 8px rgba(20,241,149,0.4)":"none"}}/>}
                      {isVal&&piece&&<div style={{position:"absolute",inset:2,borderRadius:3,border:boardTheme==="magic"?"2px solid rgba(153,69,255,0.7)":"2px solid rgba(255,23,68,0.6)",boxShadow:boardTheme==="magic"?"inset 0 0 10px rgba(153,69,255,0.3)":"none"}}/>}
                    </div>;
                  })}
                </div>;
              })}
            </div>
            </>}
            {captured.length>0&&<div style={{marginTop:4,fontSize:9,color:"#555"}}>Captured: {captured.map((p,i)=><span key={i} style={{fontSize:14}}>{PIECES[p]}</span>)}</div>}

            {/* Draw / Resign buttons */}
            {phase==="playing"&&(
              <div style={{display:"flex",gap:8,marginTop:8,pointerEvents:"auto"}}>
                <button onClick={()=>{setWon(null);setPhase("gameover");setStatus("Draw by agreement");addTx("DRAW AGREED","system");}} style={{
                  padding:"6px 16px",fontSize:11,fontWeight:600,borderRadius:6,cursor:"pointer",
                  background:"rgba(10,0,20,0.7)",border:"1px solid rgba(153,69,255,0.3)",color:"#e0b3ff",backdropFilter:"blur(8px)",
                }}>½ Draw</button>
                <button onClick={()=>setShowResignConfirm(true)} style={{
                  padding:"6px 16px",fontSize:11,fontWeight:600,borderRadius:6,cursor:"pointer",
                  background:"rgba(10,0,20,0.7)",border:"1px solid #ff1744",color:"#ff1744",backdropFilter:"blur(8px)",
                }}>🏳 Resign</button>
              </div>
            )}

            {/* Resign confirmation modal */}
            {showResignConfirm&&(
              <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={()=>setShowResignConfirm(false)}>
                <div style={{background:lm?"#fff":"#0c0c14",border:`1px solid ${lm?"#ddd":"#252540"}`,borderRadius:12,padding:24,maxWidth:300,textAlign:"center"}} onClick={e=>e.stopPropagation()}>
                  <div style={{fontSize:24,marginBottom:8}}>🏳</div>
                  <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Resign?</div>
                  <div style={{fontSize:12,color:"#888",marginBottom:16}}>You will lose this game and forfeit your entry.</div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setShowResignConfirm(false);setWon(false);setPhase("gameover");setStatus("You resigned");addTx("WHITE RESIGNED","system");}} style={{
                      flex:1,padding:"10px",background:"#ff1744",color:"white",border:"none",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",
                    }}>Yes, Resign</button>
                    <button onClick={()=>setShowResignConfirm(false)} style={{
                      flex:1,padding:"10px",background:lm?"#eee":"#14141f",color:lm?"#333":"#888",border:`1px solid ${lm?"#ddd":"#252540"}`,borderRadius:8,fontSize:13,cursor:"pointer",
                    }}>Cancel</button>
                  </div>
                </div>
              </div>
            )}

            {/* Game over inline */}
            {phase==="gameover"&&(
              <div className="magic-chess-panel" style={{marginTop:12,textAlign:"center",borderRadius:12,padding:20,maxWidth:420,borderColor:won?"#14F195":won===false?"#ff1744":"#9945FF",boxShadow:`0 0 40px ${won?"rgba(20,241,149,0.15)":"rgba(255,23,68,0.1)"},0 0 60px rgba(153,69,255,0.15)`}}>
                {/* Confetti particles on win */}
                {won&&<div style={{position:"relative",height:0,overflow:"visible"}}>
                  {Array.from({length:20},(_,i)=>(
                    <div key={i} style={{
                      position:"absolute",
                      left:`${Math.random()*100}%`,top:`${-20-Math.random()*40}px`,
                      width:6+Math.random()*6,height:6+Math.random()*6,
                      background:["#9945FF","#14F195","#ffd740","#b388ff","#00e676"][i%5],
                      borderRadius:Math.random()>0.5?"50%":"2px",
                      animation:`confettiFloat ${1+Math.random()*2}s ease-out ${Math.random()*0.5}s forwards`,
                      transform:`rotate(${Math.random()*360}deg)`,
                    }}/>
                  ))}
                </div>}

                <div className="magic-chess-title" style={{fontSize:36,fontWeight:700}}>{won?"✨ CHECKMATE ✨":won===false?"⚫ DEFEATED ⚫":"🤝 STALEMATE"}</div>
                {isWagered?(
                  <div style={{fontSize:22,fontWeight:700,color:won?"#ffd740":"#ff1744",fontFamily:"monospace"}}>{won?`+$${(totalPot*0.98).toFixed(2)} USDC`:won===false?`-$${matchStake.toFixed(2)} USDC`:"Draw — stakes returned"}</div>
                ):(
                  <>
                    <div style={{fontSize:13,color:"#b388ff",marginTop:6}}>🧙‍♂️ {mc} moves in Magic Chess</div>
                    {/* SOAR onboarding — the hook */}
                    {!publicKey?(
                      <div style={{marginTop:12,padding:12,background:"rgba(153,69,255,0.08)",borderRadius:8,border:"1px solid rgba(153,69,255,0.2)"}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#14F195",marginBottom:6}}>Save your score on-chain forever?</div>
                        <div style={{fontSize:10,color:"#888",marginBottom:8}}>Connect wallet to record {mc} moves + ELO on Solana via SOAR</div>
                        <WalletMultiButton style={{fontSize:11,height:32,width:"100%",justifyContent:"center"}}/>
                      </div>
                    ):(
                      <div style={{marginTop:12,padding:12,background:"rgba(20,241,149,0.08)",borderRadius:8,border:"1px solid rgba(20,241,149,0.2)"}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#14F195",marginBottom:4}}>Score saved on Solana ✓</div>
                        <div style={{fontSize:9,color:"#888"}}>{publicKey.toBase58().slice(0,4)}...{publicKey.toBase58().slice(-4)} &bull; SOAR Leaderboard</div>
                      </div>
                    )}
                  </>
                )}
                <div style={{fontSize:11,color:"#555",marginTop:4}}>{mc} moves &bull; {status}</div>

                {/* Streak display */}
                {won&&streak>=2&&(
                  <div style={{
                    marginTop:8,padding:"6px 16px",borderRadius:8,display:"inline-block",
                    background:streak>=5?"linear-gradient(135deg, rgba(255,215,64,0.2), rgba(255,107,44,0.2))":"rgba(255,107,44,0.1)",
                    border:`1px solid ${streak>=5?"#ffd740":"#ff6b2c"}`,
                  }}>
                    <span style={{fontSize:14,fontWeight:700,color:streak>=5?"#ffd740":"#ff6b2c"}}>
                      {streak>=10?"🔥🔥🔥 ":streak>=5?"🔥🔥 ":"🔥 "}
                      {streak}-WIN STREAK
                      {streak===bestStreak&&streak>=3?" — NEW BEST!":""}
                    </span>
                  </div>
                )}
                {won===false&&streak===0&&bestStreak>0&&(
                  <div style={{fontSize:10,color:"#555",marginTop:4}}>Streak broken. Best was {bestStreak}🔥</div>
                )}

                {/* Stats row */}
                <div style={{display:"flex",justifyContent:"center",gap:16,marginTop:8,fontSize:10,color:"#555"}}>
                  <span>W: {totalWins}</span>
                  <span>L: {totalGames-totalWins}</span>
                  <span>Best: {bestStreak}🔥</span>
                </div>

                {/* Tip the winner */}
                {won!==null&&(
                  <div style={{display:"flex",gap:4,marginTop:8,justifyContent:"center"}}>
                    <span style={{fontSize:10,color:"#888",alignSelf:"center"}}>GG! Tip {won?"winner":"opponent"}:</span>
                    {[0.1,0.5,1].map(amt=>(
                      <button key={amt} onClick={()=>addTx(`Tip ${amt} SOL — connect wallet to send`,"system")} style={{padding:"4px 10px",fontSize:10,background:"linear-gradient(135deg, rgba(255,215,64,0.1), rgba(255,107,44,0.1))",border:"1px solid rgba(255,215,64,0.3)",borderRadius:6,color:"#ffd740",cursor:"pointer",fontWeight:600}}>{amt} SOL</button>
                    ))}
                  </div>
                )}

                <div style={{display:"flex",gap:8,marginTop:12}}>
                  <button onClick={()=>{
                    const streakText=won&&streak>=3?` | ${streak}-win streak 🔥`:"";
                    const moneyText=isWagered?`\n${won?`+$${(totalPot*0.98).toFixed(2)}`:`-$${matchStake.toFixed(2)}`} USDC settled on Solana`:"";
                    const t=encodeURIComponent(`${won?"Checkmated":"Lost to"} an AI in CHESS on @gamerplex_com\n\n♟ ${mc} moves${streakText}${moneyText}\n\nI bet you can't beat me\ngamerplex.com/play/chess`);
                    window.open(`https://twitter.com/intent/tweet?text=${t}`,"_blank");
                  }} style={{flex:1,background:"#448aff",color:"white",border:"none",padding:"10px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer"}}>Challenge on X</button>
                  <button className="magic-chess-btn" onClick={()=>{reset();setExperience(null);setShowPlayFair(false);setPhase("ready");}} style={{flex:1,padding:"10px",borderRadius:8,fontSize:13,cursor:"pointer"}}>✦ Play Again ✦</button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: TABS (Match | Moves | Chat) — overlay */}
          <div style={{width:showBets?260:36,transition:"width 0.2s",overflow:"hidden",flexShrink:0,display:"flex",flexDirection:"column",pointerEvents:"auto",background:viewMode==="3d"?(showBets?"rgba(10,0,20,0.85)":"rgba(10,0,20,0.6)"):(lm?"#fafafa":"transparent"),borderLeft:viewMode==="3d"?"1px solid rgba(153,69,255,0.2)":`1px solid ${lm?"#ddd":"#252540"}`,backdropFilter:viewMode==="3d"?"blur(12px)":"none"}}>
            <div onClick={()=>setShowBets(!showBets)} style={{padding:"6px 8px",cursor:"pointer",borderBottom:viewMode==="3d"?"1px solid rgba(153,69,255,0.2)":`1px solid ${lm?"#ddd":"#252540"}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              {showBets&&(
                <div style={{display:"flex",gap:0}}>
                  {(["match","moves","chat"] as const).map(tab=>(
                    <button key={tab} onClick={(e)=>{e.stopPropagation();setRightTab(tab);}} style={{
                      padding:"4px 10px",fontSize:9,fontWeight:700,letterSpacing:1,textTransform:"uppercase",
                      background:rightTab===tab?(lm?"#e0e0e0":"#1a1a28"):"transparent",
                      border:"none",borderRadius:4,cursor:"pointer",
                      color:rightTab===tab?(tab==="match"?"#ff6b2c":tab==="moves"?"#18ffff":"#00e676"):(lm?"#999":"#555"),
                    }}>{tab}</button>
                  ))}
                </div>
              )}
              <span style={{fontSize:12,color:"#888"}}>{showBets?"▶":"◀"}</span>
            </div>
            {showBets&&(
              <div style={{flex:1,overflowY:"auto",padding:8,display:"flex",flexDirection:"column",gap:8}}>

                {/* MATCH TAB — shows real data or free play status */}
                {rightTab==="match"&&<>
                  <div style={{background:lm?"#fff":"#0c0c14",borderRadius:6,padding:10,border:`1px solid ${lm?"#ddd":"#252540"}`}}>
                    {isWagered?(
                      <>
                        <div style={{fontSize:9,color:lm?"#999":"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Match Entry</div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#888"}}>You (White)</div>
                            <div style={{fontSize:16,fontWeight:700,color:"#ffd740",fontFamily:"monospace"}}>${matchStake}</div>
                          </div>
                          <div style={{fontSize:10,color:"#555",fontWeight:700}}>vs</div>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:9,color:"#888"}}>Agent (Black)</div>
                            <div style={{fontSize:16,fontWeight:700,color:"#b388ff",fontFamily:"monospace"}}>${matchStake}</div>
                          </div>
                        </div>
                        <div style={{background:lm?"#f5f5f5":"#14141f",borderRadius:4,padding:"6px 8px",marginBottom:6}}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10}}>
                            <span style={{color:"#888"}}>Total Prize Pool</span>
                            <span style={{color:"#ff6b2c",fontWeight:700,fontFamily:"monospace"}}>${totalPot} USDC</span>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginTop:2}}>
                            <span style={{color:"#888"}}>Service Fee</span>
                            <span style={{color:"#555",fontFamily:"monospace"}}>2% (${(totalPot*0.02).toFixed(2)})</span>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginTop:2}}>
                            <span style={{color:"#888"}}>Winner Gets</span>
                            <span style={{color:"#00e676",fontWeight:700,fontFamily:"monospace"}}>${(totalPot*0.98).toFixed(2)}</span>
                          </div>
                        </div>
                        <div style={{fontSize:9,color:matchSettled?"#00e676":phase==="gameover"?"#ffd740":"#18ffff",fontWeight:600}}>
                          {matchSettled?"Settled on-chain":phase==="gameover"?"Settling...":"Match in progress"}
                        </div>
                      </>
                    ):(
                      <>
                        <div style={{fontSize:9,color:lm?"#999":"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Free Play</div>
                        <div style={{fontSize:11,color:"#888",lineHeight:1.8}}>
                          <div>Playing for fun — no entry fee</div>
                          {!publicKey&&<div style={{color:"#ffd740",marginTop:6}}>Connect wallet to record moves on-chain</div>}
                          {publicKey&&!chainRef.current?.isReady&&<div style={{color:"#ffd740",marginTop:6}}>Fund session to record moves on-chain</div>}
                          {chainRef.current?.isReady&&<div style={{color:"#00e676",marginTop:6}}>Moves recording on Solana devnet</div>}
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{background:lm?"#fff":"#0c0c14",borderRadius:6,padding:10,border:`1px solid ${lm?"#ddd":"#252540"}`}}>
                    <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Settlement</div>
                    <div style={{fontSize:9,color:"#444",lineHeight:2}}>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <span>Game State</span>
                        <span style={{color:"#18ffff"}}>MagicBlock ER</span>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <span>Wager Protocol</span>
                        <span style={{color:"#ff6b2c"}}>Contention Markets</span>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <span>Settlement</span>
                        <span style={{color:"#00e676"}}>Atomic, on-chain</span>
                      </div>
                    </div>
                  </div>

                  <div style={{background:lm?"#fff":"#0c0c14",borderRadius:6,padding:10,border:`1px solid ${lm?"#ddd":"#252540"}`}}>
                    <div style={{fontSize:9,color:lm?"#999":"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Support a Player</div>
                    <div style={{fontSize:10,color:"#888",marginBottom:8}}>Send a tip directly to their wallet</div>
                    <div style={{display:"flex",gap:4,marginBottom:6}}>
                      <button onClick={()=>addTx("Tip White — connect wallet to send","system")} style={{flex:1,padding:"8px 0",background:"linear-gradient(135deg, rgba(255,215,64,0.1), rgba(255,107,44,0.1))",border:"1px solid rgba(255,215,64,0.3)",borderRadius:6,color:"#ffd740",fontSize:10,fontWeight:700,cursor:"pointer"}}>Tip White</button>
                      <button onClick={()=>addTx("Tip Black — connect wallet to send","system")} style={{flex:1,padding:"8px 0",background:"linear-gradient(135deg, rgba(179,136,255,0.1), rgba(124,77,255,0.1))",border:"1px solid rgba(179,136,255,0.3)",borderRadius:6,color:"#b388ff",fontSize:10,fontWeight:700,cursor:"pointer"}}>Tip Black</button>
                    </div>
                    <div style={{display:"flex",gap:3,justifyContent:"center"}}>
                      {[0.1,0.5,1,5].map(amt=>(
                        <button key={amt} onClick={()=>addTx(`Tip ${amt} SOL — connect wallet`,"system")} style={{padding:"3px 8px",fontSize:8,background:lm?"#f5f5f5":"#14141f",border:`1px solid ${lm?"#ddd":"#252540"}`,borderRadius:4,color:lm?"#666":"#888",cursor:"pointer"}}>{amt} SOL</button>
                      ))}
                    </div>
                    <div style={{fontSize:8,color:"#333",marginTop:6,textAlign:"center"}}>Tips go directly to player wallets on-chain</div>
                  </div>

                  <div style={{background:lm?"#fff":"#0c0c14",borderRadius:6,padding:10,border:`1px solid ${lm?"#ddd":"#252540"}`}}>
                    <div style={{fontSize:9,color:"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Programs</div>
                    <div style={{fontSize:8,fontFamily:"monospace",color:"#444",lineHeight:2}}>
                      <div>Chess: <a href="https://explorer.solana.com/address/3LVg8uUsHtq6fusjrSfyGUCLQ83TFegDKmY3bCNz3QYr?cluster=devnet" target="_blank" rel="noopener noreferrer" style={{color:"#448aff",textDecoration:"none"}}>3LVg8u...3QYr</a></div>
                      <div>Contention: <a href="https://explorer.solana.com/address/69YfcveAbLbJ5LNERjq6k5wnszfZbXMYVzx2j8Ca1Xo8?cluster=devnet" target="_blank" rel="noopener noreferrer" style={{color:"#448aff",textDecoration:"none"}}>69Yfcv...1Xo8</a></div>
                    </div>
                  </div>
                </>}

                {/* MOVES TAB */}
                {rightTab==="moves"&&
                  <div style={{background:lm?"#fff":"#0c0c14",borderRadius:6,padding:8,border:`1px solid ${lm?"#ddd":"#252540"}`,flex:1}}>
                    <div style={{fontSize:9,color:lm?"#999":"#555",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Move History</div>
                    <div ref={histRef} style={{maxHeight:400,overflowY:"auto",fontFamily:"monospace",fontSize:10,lineHeight:1.8}}>
                      {!hist.length&&<div style={{color:"#333"}}>No moves yet</div>}
                      {Array.from({length:Math.ceil(hist.length/2)},(_,i)=>(
                        <div key={i} style={{display:"flex",gap:6}}>
                          <span style={{color:"#555",width:16}}>{i+1}.</span>
                          <span style={{color:lm?"#8B6914":"#ffd740",width:44}}>{hist[i*2]||""}</span>
                          <span style={{color:lm?"#5B3DAF":"#b388ff"}}>{hist[i*2+1]||""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                }

                {/* CHAT TAB */}
                {rightTab==="chat"&&<>
                  {/* Destroy chat toggle */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"}}>
                    <span style={{fontSize:9,color:"#555"}}>Auto-destroy chat</span>
                    <button onClick={()=>{
                      if(destroyChat){setShowSaveChatModal(true);}
                      else{setDestroyChat(true);}
                    }} style={{
                      width:36,height:18,borderRadius:9,border:"none",cursor:"pointer",
                      background:destroyChat?"#00e676":"#555",position:"relative",transition:"background 0.2s",
                    }}>
                      <div style={{
                        width:14,height:14,borderRadius:7,background:"white",position:"absolute",top:2,
                        left:destroyChat?20:2,transition:"left 0.2s",
                      }}/>
                    </button>
                  </div>

                  {/* Messages */}
                  <div ref={chatRef} style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:6,maxHeight:300}}>
                    {chatMessages.length===0&&<div style={{fontSize:10,color:"#333",textAlign:"center",marginTop:20}}>Say something to your opponent...</div>}
                    {chatMessages.map((m,i)=>(
                      <div key={i} style={{
                        alignSelf:m.from==="You"?"flex-end":"flex-start",
                        background:m.from==="You"?(lm?"#e3f2fd":"rgba(68,138,255,0.15)"):(lm?"#f3e5f5":"rgba(179,136,255,0.15)"),
                        borderRadius:8,padding:"6px 10px",maxWidth:"85%",
                      }}>
                        <div style={{fontSize:8,color:"#555",marginBottom:2}}>{m.from}</div>
                        <div style={{fontSize:11,color:lm?"#222":"#e8e8f0"}}>{m.msg}</div>
                      </div>
                    ))}
                  </div>

                  {/* Input */}
                  <div style={{display:"flex",gap:4,marginTop:4}}>
                    <input
                      value={chatInput}
                      onChange={e=>setChatInput(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter")sendChat(chatInput);}}
                      placeholder="Type a message..."
                      style={{
                        flex:1,padding:"6px 8px",fontSize:11,
                        background:lm?"#fff":"#14141f",border:`1px solid ${lm?"#ddd":"#252540"}`,
                        borderRadius:6,color:lm?"#222":"#e8e8f0",outline:"none",
                        fontFamily:"'Space Grotesk', sans-serif",
                      }}
                    />
                    <button onClick={()=>sendChat(chatInput)} style={{
                      background:"#448aff",color:"white",border:"none",borderRadius:6,
                      padding:"6px 10px",fontSize:11,cursor:"pointer",fontWeight:700,
                    }}>→</button>
                  </div>

                  <div style={{fontSize:8,color:"#333",marginTop:4,textAlign:"center"}}>
                    {destroyChat?"Chat destroyed after game ends":"Chat will be saved on-chain (coming soon)"}
                  </div>
                </>}
              </div>
            )}
          </div>

          </div>{/* end overlay layout */}

          {/* Save Chat Modal */}
          {showSaveChatModal&&(
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={()=>setShowSaveChatModal(false)}>
              <div style={{background:lm?"#fff":"#0c0c14",border:`1px solid ${lm?"#ddd":"#252540"}`,borderRadius:12,padding:24,maxWidth:360,textAlign:"center"}} onClick={e=>e.stopPropagation()}>
                <div style={{fontSize:32,marginBottom:8}}>💬</div>
                <div style={{fontSize:16,fontWeight:700,marginBottom:8}}>Save Chat On-Chain</div>
                <div style={{fontSize:12,color:"#888",marginBottom:16,lineHeight:1.6}}>
                  Permanent on-chain chat storage is a future feature. Your chat messages would be stored forever on Solana using MagicBlock ephemeral accounts.
                </div>
                <div style={{fontSize:11,color:"#555",marginBottom:16}}>
                  Want this feature? Let us know in the Discord!
                </div>
                <div style={{display:"flex",gap:8}}>
                  <a href="https://discord.gg/gamerplex" target="_blank" style={{
                    flex:1,padding:"10px",background:"#5865F2",color:"white",borderRadius:8,
                    fontSize:13,fontWeight:700,textDecoration:"none",textAlign:"center",
                  }}>Join Discord</a>
                  <button onClick={()=>setShowSaveChatModal(false)} style={{
                    flex:1,padding:"10px",background:lm?"#eee":"#14141f",color:lm?"#333":"#888",
                    border:`1px solid ${lm?"#ddd":"#252540"}`,borderRadius:8,fontSize:13,cursor:"pointer",
                  }}>Got it</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
