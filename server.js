const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req,res)=>res.json({ok:true}));
const rooms = new Map();
const makePin = () => { let pin; do { pin=String(Math.floor(100000+Math.random()*900000)); } while(rooms.has(pin)); return pin; };
function publicPlayers(room){return [...room.players.values()].map(p=>({id:p.id,name:p.name,score:p.score})).sort((a,b)=>b.score-a.score);}
function broadcastLobby(pin){const r=rooms.get(pin);if(r)io.to(pin).emit('lobbyUpdate',{pin,players:publicPlayers(r)});}
function leaderboard(pin,finished=false){const r=rooms.get(pin);if(r)io.to(pin).emit('showLeaderboard',{pin,players:publicPlayers(r),finished});}
function sendQuestion(pin){const r=rooms.get(pin);if(!r)return;if(r.index>=r.questions.length){leaderboard(pin,true);return;}r.answered.clear();r.revealed=false;r.questionStarted=Date.now();io.to(pin).emit('newQuestion',{pin,index:r.index,total:r.questions.length,question:{q:r.questions[r.index].q,a:r.questions[r.index].a},duration:r.duration});}
io.on('connection',socket=>{
 socket.on('createRoom',(data,cb)=>{
  if(!data||!Array.isArray(data.questions)||!data.questions.length)return cb?.({ok:false,error:'Не удалось загрузить вопросы.'});
  const pin=makePin(),duration=Math.max(10,Math.min(60,Number(data.duration)||20));
  const room={pin,hostId:socket.id,hostName:String(data.name||'Преподаватель').slice(0,30),duration,questions:data.questions,index:0,players:new Map(),answered:new Map(),revealed:false,started:false};
  rooms.set(pin,room);socket.join(pin);socket.data.hostPin=pin;cb?.({ok:true,pin});broadcastLobby(pin);
 });
 socket.on('joinRoom',(data,cb)=>{
  const pin=String(data?.pin||'').trim(),name=String(data?.name||'').trim(),r=rooms.get(pin);
  if(!r)return cb?.({ok:false,error:'Комната не найдена. Проверь PIN-код.'});
  if(r.started)return cb?.({ok:false,error:'Игра уже началась. Попроси преподавателя создать новую комнату.'});
  if(!name)return cb?.({ok:false,error:'Введи имя участника.'});
  const player={id:socket.id,name:name.slice(0,24),score:0};r.players.set(socket.id,player);socket.join(pin);socket.data.playerPin=pin;
  cb?.({ok:true,pin,playerId:socket.id});broadcastLobby(pin);
 });
 socket.on('startGame',(data,cb)=>{const pin=String(data?.pin||''),r=rooms.get(pin);if(!r||r.hostId!==socket.id)return cb?.({ok:false,error:'Только ведущий может запустить игру.'});if(!r.players.size)return cb?.({ok:false,error:'Сначала дождись хотя бы одного участника.'});r.started=true;r.index=0;io.to(pin).emit('gameStarted',{pin});sendQuestion(pin);cb?.({ok:true});});
 socket.on('submitAnswer',(data,cb)=>{const pin=String(data?.pin||''),r=rooms.get(pin);if(!r||!r.started||r.revealed||!r.players.has(socket.id))return cb?.({ok:false,error:'Сейчас нельзя отправить ответ.'});if(r.answered.has(socket.id))return cb?.({ok:false,error:'Ответ уже отправлен.'});const choice=Number(data.choice);if(!Number.isInteger(choice)||choice<0||choice>3)return cb?.({ok:false,error:'Некорректный вариант ответа.'});const p=r.players.get(socket.id);const correct=choice===r.questions[r.index].c;const elapsed=Date.now()-r.questionStarted;const remaining=Math.max(0, r.duration*1000-elapsed);const points=correct?500+Math.round(500*remaining/(r.duration*1000)):0;p.score+=points;r.answered.set(socket.id,{choice,correct,points});cb?.({ok:true});io.to(pin).emit('answerCount',{pin,answered:r.answered.size,total:r.players.size});});
 socket.on('revealAnswers',data=>{const pin=String(data?.pin||''),r=rooms.get(pin);if(!r||r.hostId!==socket.id||r.revealed)return;r.revealed=true;const item=r.questions[r.index];io.to(pin).emit('questionResults',{pin,correct:item.c,answer:item.a[item.c],players:publicPlayers(r)});});
 socket.on('nextQuestion',(data)=>{const pin=String(data?.pin||''),r=rooms.get(pin);if(!r||r.hostId!==socket.id||!r.revealed)return;r.index++;if(r.index>=r.questions.length){leaderboard(pin,true);return;}leaderboard(pin,false);});
 socket.on('continueGame',(data)=>{const pin=String(data?.pin||''),r=rooms.get(pin);if(!r||r.hostId!==socket.id||r.revealed)return;sendQuestion(pin);});
 socket.on('finishGame',data=>{const pin=String(data?.pin||''),r=rooms.get(pin);if(r&&r.hostId===socket.id)leaderboard(pin,true);});
 socket.on('closeRoom',data=>{const pin=String(data?.pin||''),r=rooms.get(pin);if(r&&r.hostId===socket.id){io.to(pin).emit('roomClosed',{pin});rooms.delete(pin);}});
 socket.on('disconnect',()=>{const pin=socket.data.playerPin;const r=rooms.get(pin);if(r&&r.players.has(socket.id)){r.players.delete(socket.id);r.answered.delete(socket.id);broadcastLobby(pin);}const hostPin=socket.data.hostPin;const hr=rooms.get(hostPin);if(hr&&hr.hostId===socket.id){io.to(hostPin).emit('roomClosed',{pin:hostPin});rooms.delete(hostPin);}});
});
server.listen(PORT,()=>console.log(`Quiz Battle running on port ${PORT}`));
