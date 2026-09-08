"""Import the fixed official feedforward ONNX policy; optimize a residual only."""
import numpy as np
import torch
from torch import nn
import onnx
from onnx import numpy_helper

class BasePolicy(nn.Module):
    def __init__(self, filename):
        super().__init__()
        model = onnx.load(filename)
        expected = ['Sub', 'Div', 'Gemm', 'Elu', 'Gemm', 'Elu', 'Gemm', 'Elu', 'Gemm']
        if [n.op_type for n in model.graph.node] != expected:
            raise ValueError('Base ONNX graph does not match the supported Microduck walking policy')
        values = {t.name: numpy_helper.to_array(t).copy() for t in model.graph.initializer}
        self.register_buffer('mean', torch.from_numpy(values[model.graph.node[0].input[1]]))
        self.register_buffer('scale', torch.from_numpy(values[model.graph.node[1].input[1]]))
        layers = []
        for node in model.graph.node[2:]:
            if node.op_type == 'Elu': layers.append(nn.ELU())
            else:
                attrs = {a.name: onnx.helper.get_attribute_value(a) for a in node.attribute}
                if attrs.get('transB', 0) != 1 or attrs.get('alpha', 1) != 1 or attrs.get('beta', 1) != 1:
                    raise ValueError('Unsupported Gemm attributes')
                w, b = values[node.input[1]], values[node.input[2]]
                layer = nn.Linear(w.shape[1], w.shape[0])
                layer.weight.data.copy_(torch.from_numpy(w)); layer.bias.data.copy_(torch.from_numpy(b))
                layers.append(layer)
        self.net = nn.Sequential(*layers)
        self.requires_grad_(False)

    def forward(self, obs): return self.net((obs-self.mean)/self.scale)

class Actor(nn.Module):
    def __init__(self, base, residual):
        super().__init__(); self.base = base; self.residual = residual
    def forward(self, obs):
        return self.base(obs) + 0.08 * torch.tanh(self.residual(obs))
