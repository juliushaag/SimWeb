import io
from pathlib import Path
import flask
from simweb.adapter import SimPubAdapter
import logging

class SimViz:

  def __init__(self):

    self.adapter = SimPubAdapter()

    self.own_path = Path(__file__).parent
    
    self.app = flask.Flask("simviz", template_folder=self.own_path / "web", static_folder= self.own_path / "web/static")
    print("You can access the web interface at http://127.0.0.1:5000")
    
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    
    self.app.add_url_rule('/', 'index', self.get_index)
    self.app.add_url_rule('/scene_id', 'scene_id', self.get_scene_id)
    self.app.add_url_rule('/scene_data', 'scene_data', self.get_scene)
    self.app.add_url_rule('/scene_state', 'scene_state', self.get_state)
    self.app.add_url_rule('/data/<hash>', 'data', self.get_data)

    self.app.run()
    
  
  """
  Webserver connection
  """
  def get_index(self):
    return flask.render_template("index.html")

  def get_scene_id(self): 
    return str(self.adapter.scene_id)
  
  def get_scene(self):
    return self.adapter.scene_info or {}
  
  def get_state(self):
    return self.adapter.scene_state or {}
  
  def get_data(self, hash):
    data = self.adapter.get_asset(hash)
    if data is not None:
      return flask.send_file(io.BytesIO(data), mimetype='blob/bin')
    return "Invalid data request", 404

def main():
  sim = SimViz()


if __name__ == "__main__":
  main()