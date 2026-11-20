import Base
import ../../../core/engine.bend as E
import ../../../core/parameters.bend as P
import ../../../agents/lib/linear.bend as L

# Perceptual model for the opt-in preview study only. No access to the source
# world or its road identities; right-hand curves reflect lane & steering.
type Sense is Data:
  Sense{remaining: U32, lane: U32, speed: U32, look: U32}
def Model() -> Data: L.Model

def initial(seed: U32,params: P.Parameters) -> Model:
  # Eight binary active features give effective step size .25.
  L.initial(L.Settings{0.03125,1.0,16384})

def decode(+raw: U32) -> Sense:
  +pose=U32.div(raw,125)
  Sense{U32.add(1,U32.div(pose,9)),U32.mod(U32.div(pose,3),3),
    U32.add(1,U32.mod(pose,3)),U32.mod(raw,125)}

def first(+a: U32,b: U32) -> U32:
  match a:
    case 0: b
    case _: a

def d0(preview: U32) -> U32: U32.mod(preview,5)
def d1(preview: U32) -> U32: U32.mod(U32.div(preview,5),5)
def d2(preview: U32) -> U32: U32.div(preview,25)

def mirrored(+p: U32) -> Bool:
  +focus=first(d0(p),first(d1(p),d2(p)))
  U32.is_eq(focus,2) || U32.is_eq(focus,4)

def reverse_curve(d: U32) -> U32:
  match d:
    case 1: 2
    case 2: 1
    case 3: 4
    case 4: 3
    case _: 0

def reverse_look(+look: U32) -> U32:
  U32.add(reverse_curve(d0(look)),U32.add(U32.mul(5,reverse_curve(d1(look))),U32.mul(25,reverse_curve(d2(look)))))

def reverse_lane(lane: U32) -> U32: U32.sub(2,lane)

def canonical(+flip: Bool,s: Sense) -> Sense:
  Sense{left,+lane,sp,+look}=s
  Sense{left,Bool.pick(U32,flip,reverse_lane(lane),lane),sp,Bool.pick(U32,flip,reverse_look(look),look)}

def steering(flip: Bool,act: U32) -> U32:
  match flip act:
    case True{} 3: 4
    case True{} 4: 3
    case _ other: other

def coarse(remaining: U32) -> U32: U32.min(3,U32.div(U32.sub(remaining,1),3))

def nearest(+a: U32,+b: U32,c: U32) -> U32:
  match a b c:
    case 0 0 0: 0
    case 0 0 x: U32.add(8,x)
    case 0 x _: U32.add(4,x)
    case x _ _: x

def basis(s: Sense) -> L.Features:
  Sense{left,+lane,+speed,+look}=s
  +corner=nearest(d0(look),d1(look),d2(look))
  +pose=U32.add(U32.mul(3,lane),U32.sub(speed,1))
  [L.Feature{0,1.0},
   L.Feature{speed,1.0},
   L.Feature{U32.add(4,lane),1.0},
   L.Feature{U32.add(7,coarse(left)),1.0},
   L.Feature{U32.add(11,corner),1.0},
   L.Feature{U32.add(24,look),1.0},
   L.Feature{U32.add(150,pose),1.0},
   L.Feature{U32.add(160,U32.add(U32.mul(9,corner),pose)),1.0}]

def with_sensors(s: Sense) -> L.Features:
  Sense{remaining,lane,speed,+look}=s
  basis(canonical(mirrored(look),Sense{remaining,lane,speed,look}))

def features(obs: U32) -> L.Features:
  match obs:
    case 0: []
    case n: with_sensors(decode(U32.sub(n,1)))

def flip_at(obs: U32) -> Bool:
  match obs:
    case 0: False{}
    case n: mirrored(U32.mod(U32.sub(n,1),125))

# Always legal to choose each of the five actions on a live grid. Mirroring
# permutes only L/R. The greedy bootstrap already uses all available actions.
def choose(model: Model,+obs: U32,legal: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  steering(flip_at(obs),L.act(~U32,~features,model,obs,legal,mode,word))

def act(model: Model,obs: U32,legal: List<&2,U32>,mode: E.Mode,word: U32) -> U32:
  choose(model,obs,legal,mode,word)

def canonical_event(event: E.Transition<U32>) -> E.Transition<U32>:
  E.Transition{+obs,act,reward,next,truncated}=event
  E.Transition{obs,steering(flip_at(obs),act),reward,next,truncated}

def learn(model: Model,event: E.Transition<U32>) -> Model:
  L.learn(~U32,~features,model,canonical_event(event))
