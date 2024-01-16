import HashRingInterface from './hashring/HashRingInterface'

export default class Client {
  HashRing:HashRingInterface
  constructor(serverUris:Array<string>, options?:any)
  get(key:string):Promise<{ value:Buffer }>
  set(key:string, value:Buffer, options?:{ expires:number }):Promise<boolean>
  add(key:string, value:Buffer, options?:{ expires:number }):Promise<boolean>
  replace(key:string, value:Buffer, options?:{ expires:number }):Promise<boolean>
  delete(key:string):Promise<boolean> 
  increment(key:string, amount:number, options?:{ initial?:number, expires?:number }):Promise<{success:boolean, value:number}>
  decrement(key:string, amount:number, options?:{ initial?:number, expires?:number }):Promise<{success:boolean, value:number}>
  append(key:string, value:Buffer):Promise<boolean>
  prepend(key:string, value:Buffer):Promise<boolean>
  touch(key:string, expires:number):Promise<boolean>
  // flush():Promise<Record<string, boolean>>
}