import Base

type Parameter is Data:
  Parameter{name: String, value: F32}

def Parameters() -> Data: List<&2,Parameter>

def get(parameters: Parameters, +name: String, fallback: F32) -> F32:
  match parameters:
    case Nil{}: fallback
    case Parameter{k,v} <> rest: Bool.pick(F32,String.eq(k,name),v,get(rest,name,fallback))
