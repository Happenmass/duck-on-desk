"""Official Microduck actor: preserve its graph and normalization, fine-tune all weights."""
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
        self.requires_grad_(True)

    def forward(self, obs): return self.net((obs-self.mean)/self.scale)


def official_finetune_policy(filename, build_policy):
    """Load every official parameter into the matching declared architecture.

    Never silently interpret an old 64-unit residual draft as full fine-tuning.
    Normalization buffers stay exactly as exported in the original ONNX.
    """
    actor = BasePolicy(filename)
    declared = build_policy(61, 14)
    expected = list(actor.net.children())
    if type(declared) is not nn.Sequential or len(declared) != len(expected):
        raise ValueError('策略脚本必须使用官方 61→512→256→128→14 / ELU 结构。旧修正网络草稿请改用当前官方模板。')
    for source, target in zip(expected, declared):
        if type(source) is not type(target):
            raise ValueError('策略网络激活函数必须与官方 ELU 结构一致')
        if isinstance(source, nn.Linear) and (source.in_features != target.in_features or source.out_features != target.out_features or target.bias is None):
            raise ValueError('策略网络各层尺寸必须与官方 61→512→256→128→14 一致')
        if isinstance(source, nn.ELU) and (source.alpha != target.alpha or target.inplace):
            raise ValueError('策略网络必须使用官方 ELU(alpha=1, inplace=False)')
    declared.load_state_dict(actor.net.state_dict(), strict=True)
    actor.net = declared
    actor.requires_grad_(True)
    return actor


def randomize_policy(actor):
    """Same actor architecture, independently randomized trainable parameters.

    Neutral fixed input normalization avoids carrying walking statistics into a
    new skill. Both buffers remain in ONNX, so training and deployment agree.
    """
    for layer in actor.net:
        if isinstance(layer, nn.Linear): layer.reset_parameters()
    with torch.no_grad():
        actor.mean.zero_(); actor.scale.fill_(1)
    return actor
