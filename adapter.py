from dataclasses import dataclass, asdict
import enum
import ipaddress
import json
from threading import Lock, Thread
import time
from typing import Callable
import zmq
import socket
import netifaces

class ServerPort(int, enum.Enum):
  Discovery = 7720,
  Service = 7721
  Topic = 7722

class ClientPort(int, enum.Enum):
  Discovery = 7720
  Service = 7723
  Topic = 7724

@dataclass 
class NetInfo:
  name : str
  ip : str
  topics : list
  services : list


class SimPubAdapter:

  def __init__(self) -> None:
    
    # Setup broadcasting receiving socket
    self.discoveryClient = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    self.discoveryClient.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    self.discoveryClient.bind(('', ClientPort.Discovery))
    self.discoveryClient.setblocking(False)

    self.service_callbacks : dict[str, Callable[[str], str]]= dict()
    self.topics_callbacks : dict[str, Callable[[str], None]] = dict()

    # request socket
    self.zmq_ctx = zmq.Context()

    self.reqSocket = zmq.Socket(self.zmq_ctx, zmq.REQ)

    self.reqLock = Lock()

    self.repSocket = zmq.Socket(self.zmq_ctx, zmq.REP)
    self.subSocket = zmq.Socket(self.zmq_ctx, zmq.SUB)
    self.pubSocket = zmq.Socket(self.zmq_ctx, zmq.PUB)
    
    self.sockets = [ self.reqSocket, self.repSocket, self.subSocket, self.pubSocket ]
    
    self.local_info = NetInfo("WebInterface", None, None, None)

    self.scene_info = None
    self.scene_id = 0

    self.assets = dict()

    self.server_id = None

    self.connected = False
    self.running = True
    self.loop = Thread(target=self._update_loop)
    self.loop.start()

    def change_host_name(name):
      self.local_info = name

    self.register_service("ChangeHostName", change_host_name)

    self.scene_state = {}
    def scene_update(scene_state):
      self.scene_state = scene_state

    self.subscribe_topic("SceneUpdate", scene_update)

  def request(self, service : str, request : str = "", recv_type : type = str) -> bytes | str:
    with self.reqLock:
      self.reqSocket.send_string(f"{service}:{request}")
      
      assert recv_type in { str, bytes }

      # TODO: Whats the best way to add a timeout ? 
      if recv_type == str:
        return self.reqSocket.recv_string()
      elif recv_type == bytes:
        return self.reqSocket.recv()


  def get_asset(self, asset : str) -> bytes:

    if asset in self.assets:
      return self.assets[asset]

    req = self.request("Asset", asset, bytes)
    if len(req) != 0:
      self.assets[asset] = req
      return req
    else:
      return None
    

  def subscribe_topic(self, topic : str, action : Callable[[str], None]):
    self.topics_callbacks[topic] = action

  def unsubscribe_topic(self, topic : str):
    del self.topics_callbacks[topic]


  def register_service(self, service : str, action : Callable[[str], str]):
    self.service_callbacks[service] = action

  def unregister_serivce(self, service : str):
    del self.service_callbacks[service]


  def __del__(self):
    self.discoveryClient.close()
    self.pubSocket.close()
    self.repSocket.close()
    self.reqSocket.close()

  def _update_loop(self):
    
    while self.running:
      
      if self.connected:
        self._process_topics()
        self._process_services()

      try:
        data, addr =  self.discoveryClient.recvfrom(1024)


        if not data.startswith(b"SimPub"): continue

        data = data.decode()
        addr = addr[0]

        _, conn_id, conn_info = data.split(':', 2)

        if conn_id == self.server_id: continue

        self.server_id = conn_id

        conn_info = json.loads(conn_info)
        conn_info["name"] = conn_info["host"]
        del conn_info["host"]

        self.server_info = NetInfo(**conn_info)
        self.server_info.ip = addr

        self.local_info.ip = self._get_local_ips_in_same_subnet(addr)

        self._start_connection()


      except BlockingIOError as e:
        pass # Not data received

      if not self.connected: time.sleep(1)

  def _stop_connection(self):
    assert self.connected

    self.subSocket.disconnect(f"tcp://{self.server_info.ip}:{ServerPort.Topic.value}")
    self.repSocket.unbind(f"tcp://{self.local_info.ip}:{ClientPort.Service.value}")
    self.pubSocket.unbind(f"tcp://{self.local_info.ip}:{ClientPort.Topic.value}")
    self.reqSocket.disconnect(f"tcp://{self.server_info.ip}:{ServerPort.Service.value}")
    self.connected = False

  def _start_connection(self):
    if self.connected: self._stop_connection() 

    assert not self.connected

    self.subSocket.connect(f"tcp://{self.server_info.ip}:{ServerPort.Topic.value}")
    self.subSocket.subscribe("")
    self.repSocket.bind(f"tcp://{self.local_info.ip}:{ClientPort.Service.value}")
    self.pubSocket.bind(f"tcp://{self.local_info.ip}:{ClientPort.Topic.value}")
    self.reqSocket.connect(f"tcp://{self.server_info.ip}:{ServerPort.Service.value}")

    self.connected = True

    self.request("Register", json.dumps(asdict(self.local_info)))

    self._load_scene()


  def _load_scene(self):

    self.scene_info = json.loads(self.request("Scene"))
    self.scene_id = self.scene_info["id"]



  def _process_topics(self):

    try:
      message = self.subSocket.recv_string(flags=zmq.NOBLOCK)
      topic, msg = message.split(":", 1)
      if topic not in self.topics_callbacks: 
        return
      
      self.topics_callbacks[topic](msg)

    except (zmq.error.Again, zmq.error.ZMQError):
      return 

  def _process_services(self):

    try:
      message = self.repSocket.recv_string(flags=zmq.NOBLOCK)
      topic, msg = message.split(":", 1)
      if topic not in self.service_callbacks: 
        self.repSocket.send_string("Invalid Service")
        return
      
      
      resp = self.service_callbacks[topic](msg)
      self.repSocket.send_string(resp)

    except (zmq.error.Again, zmq.error.ZMQError):
      return 


  def _get_local_ips_in_same_subnet(self, input_ip_address: str) -> str:

    try:
        input_ip_address = ipaddress.IPv4Address(input_ip_address)
    except ValueError:
        raise ValueError("Invalid IP address format.")
    
    subnet_mask = ipaddress.IPv4Address("255.255.255.0")

    # Get all network interfaces
    for interface in netifaces.interfaces():
        # Get addresses for this interface
        addrs = netifaces.ifaddresses(interface)
        # Check IPv4 addresses (AF_INET is for IPv4)
        if netifaces.AF_INET not in addrs: continue
        
        for addr_info in addrs[netifaces.AF_INET]:
            local_ip = addr_info['addr']
              
            mask_int = int(subnet_mask)
            input_int = int(input_ip_address)
            local_int = int(ipaddress.IPv4Address(local_ip))

            if not (input_int & mask_int) == (local_int & mask_int): continue

            return local_ip



if __name__ == "__main__":

  SimPubAdapter()