export const str={type:'string',minLength:1,maxLength:2048};
export const uint={type:'integer',minimum:0,maximum:4294967295};
export const horizon={type:'integer',minimum:1,maximum:4096};
export const choice=(...values)=>({type:'string',enum:values});
export const schema=(properties,required)=>({type:'object',properties,additionalProperties:false,required});
export const tool=(description,properties,required,readOnly,run)=>({description,inputSchema:schema(properties,required),readOnly,run});
