import Base
import ./engine.bend as E
import ./parameters.bend as P

# Orders arrive before daily demand. Capacity is three units. Observations
# encode opening stock and remaining days, so the last day's policy may differ.
type State is Data:
  Stock{on_hand: U32, days: Nat, price: F32, holding: F32}

def Observation() -> Data: U32

def reset(price: F32, holding: F32, days: Nat, seed: U32) -> State:
  Stock{0,days,price,holding}

def orders(stock: U32) -> List<&2,U32>:
  match stock:
    case 0: [0,1,2,3]
    case 1: [0,1,2]
    case 2: [0,1]
    case _: [0]

def view(state: State) -> E.View<U32>:
  match state:
    case Stock{s,0n,p,h}: E.End{s}
    case Stock{+s,1n+d,p,h}: E.Open{U32.add(s,U32.mul(4,U32.from_nat(1n+d))),orders(s)}

def demand(word: U32) -> U32:
  +b=U32.and(word,3)
  U32.add(Bool.to_u32(U32.is_ge(b,1)),Bool.to_u32(U32.is_eq(b,3)))

def step(state: State, +order: U32, word: U32) -> Pair(State,F32):
  match state:
    case Stock{s,0n,p,h}: (Stock{s,0n,p,h},0.0)
    case Stock{s,1n+left,+price,+holding}:
      +available=U32.add(s,order)
      +wanted=demand(word)
      +sold=U32.min(wanted,available)
      +closing=U32.sub(available,sold)
      revenue=F32.mul(price,U32.to_f32(sold))
      costs=F32.add(U32.to_f32(order),F32.add(F32.mul(holding,U32.to_f32(closing)),U32.to_f32(U32.sub(wanted,sold))))
      (Stock{closing,left,price,holding},F32.sub(revenue,costs))

def world(params: P.Parameters) -> E.World<State,Observation>:
  +p=params
  price=P.get(p,"price",3.0)
  holding=P.get(p,"holding",0.25)
  days=F32.to_nat(F32.max(1.0,F32.min(1000.0,P.get(p,"days",5.0))))
  E.World{seed => reset(price,holding,days,seed),view,s => a => w => step(s,a,w)}
