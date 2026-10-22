import {mkdir,rm,copyFile} from 'node:fs/promises';
await rm('public',{recursive:true,force:true});await mkdir('public');
for(const name of ['index.html','style.css','script.js','location.js','v7.css','v8.css','pwa.js','service-worker.js','manifest.webmanifest','icon-192.png','icon-512.png'])await copyFile(name,`public/${name}`);
