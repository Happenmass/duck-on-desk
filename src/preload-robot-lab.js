'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('robotLabAPI',{request:(action,payload)=>ipcRenderer.invoke('robot-lab:request',{action,payload}),onLesson:callback=>ipcRenderer.on('robot-lab:lesson',(_,lesson)=>callback(lesson))});
